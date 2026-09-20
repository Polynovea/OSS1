export async function revalidateWebsiteBlog(slug?: string): Promise<void> {
  const websiteUrl = process.env.WEBSITE_URL;
  const secret = process.env.WEBSITE_REVALIDATE_SECRET;
  if (!websiteUrl || !secret) return;

  try {
    await fetch(`${websiteUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ slug }),
    });
  } catch {
    // Non-fatal — website cache will expire on its own
  }
}
