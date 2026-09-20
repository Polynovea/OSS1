export interface ExecutionDagNode {
  id: string;
  node_key: string;
  ordinal: number;
  deterministic_classification?: string | null;
  retry_semantics?: string | null;
}

export interface ExecutionDagEdge {
  from_node_id: string;
  to_node_id: string;
}

export interface ExecutionDagShape<T extends ExecutionDagNode> {
  ordered: T[];
  levels: T[][];
  prerequisitesByNodeId: Map<string, string[]>;
}

/**
 * Builds a deterministic topological order plus execution levels. Nodes in the
 * same level are independent of one another and may be considered for safe
 * parallel execution by the controller.
 */
export function buildExecutionDagShape<T extends ExecutionDagNode>(nodes: T[], edges: ExecutionDagEdge[]): ExecutionDagShape<T> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  const prerequisitesByNodeId = new Map<string, string[]>();

  for (const node of nodes) prerequisitesByNodeId.set(node.id, []);
  for (const edge of edges) {
    if (!byId.has(edge.from_node_id) || !byId.has(edge.to_node_id)) {
      throw new Error("Execution graph references an unknown node");
    }
    indegree.set(edge.to_node_id, (indegree.get(edge.to_node_id) ?? 0) + 1);
    outgoing.set(edge.from_node_id, [...(outgoing.get(edge.from_node_id) ?? []), edge.to_node_id]);
    prerequisitesByNodeId.set(edge.to_node_id, [...(prerequisitesByNodeId.get(edge.to_node_id) ?? []), edge.from_node_id]);
  }

  let ready = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.ordinal - b.ordinal || a.node_key.localeCompare(b.node_key));
  const ordered: T[] = [];
  const levels: T[][] = [];

  while (ready.length) {
    const level = [...ready];
    levels.push(level);
    ordered.push(...level);
    const nextReady: T[] = [];
    for (const node of level) {
      for (const targetId of outgoing.get(node.id) ?? []) {
        const next = (indegree.get(targetId) ?? 0) - 1;
        indegree.set(targetId, next);
        if (next === 0) nextReady.push(byId.get(targetId)!);
      }
    }
    ready = nextReady.sort((a, b) => a.ordinal - b.ordinal || a.node_key.localeCompare(b.node_key));
  }

  if (ordered.length !== nodes.length) {
    throw Object.assign(new Error("Execution graph contains a cycle"), { status: 409 });
  }

  return { ordered, levels, prerequisitesByNodeId };
}

export function topologicalExecutionOrder<T extends ExecutionDagNode>(nodes: T[], edges: ExecutionDagEdge[]): T[] {
  return buildExecutionDagShape(nodes, edges).ordered;
}

export function prerequisiteFailureIds(nodeId: string, prerequisitesByNodeId: Map<string, string[]>, statuses: Map<string, string>): string[] {
  return (prerequisitesByNodeId.get(nodeId) ?? []).filter((dependencyId) => statuses.get(dependencyId) !== "succeeded");
}

export function isSafelyParallelizable(node: ExecutionDagNode): boolean {
  return node.deterministic_classification === "safe" && node.retry_semantics === "safe_retry";
}
