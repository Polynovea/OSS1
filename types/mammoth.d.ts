declare module "mammoth" {
  export interface ConvertToHtmlInput {
    buffer?: Buffer;
    path?: string;
  }

  export interface ConvertResult {
    value: string;
    messages: unknown[];
  }

  export interface ConvertToHtmlOptions {
    styleMap?: string | string[];
  }

  export function convertToHtml(input: ConvertToHtmlInput, options?: ConvertToHtmlOptions): Promise<ConvertResult>;

  const mammoth: {
    convertToHtml: typeof convertToHtml;
  };
  export default mammoth;
}
