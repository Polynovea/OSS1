type Article = { id: string; data_json?: { title?: string; summary?: string } };

async function getArticles(): Promise<Article[]> {
  const baseUrl = process.env.POLYNOVEA_CMS_URL;
  const token = process.env.POLYNOVEA_CMS_TOKEN;
  if (!baseUrl || !token) return [];
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/content/demo_article?limit=20`, {
    headers: { authorization: `Bearer ${token}` },
    next: { revalidate: 60 },
  });
  if (!response.ok) throw new Error(`Polynovea request failed: ${response.status}`);
  const body = await response.json();
  return body.data || [];
}

export default async function Page() {
  const articles = await getArticles();
  return <main style={{ maxWidth: 760, margin: "64px auto", fontFamily: "system-ui", padding: 24 }}>
    <h1>Published with Polynovea CMS</h1>
    {articles.length === 0 ? <p>Configure the server-only CMS URL and token, then publish a Demo Article.</p> : articles.map((article) => <article key={article.id}>
      <h2>{article.data_json?.title || "Untitled"}</h2>
      <p>{article.data_json?.summary}</p>
    </article>)}
  </main>;
}
