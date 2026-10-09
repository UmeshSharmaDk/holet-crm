export const BACKEND_ACCESS_MESSAGE =
  "The app cannot reach the CRM sign-in service. The server may be behind Replit's private-access page or using an incorrect address. Ask the administrator to enable mobile API access; publishing to an app store is not required.";

/** Never treat a hosting sign-in page as a successful CRM API response. */
export async function readLoginJson(response: Response): Promise<any> {
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error(BACKEND_ACCESS_MESSAGE);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("The CRM server returned an invalid response. Please try again or contact the administrator.");
  }
}

/** A safe, credential-free probe before posting passwords from native apps. */
export async function verifyNativeLoginService(baseUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    await readLoginJson(response);
    if (response.status !== 200 && response.status !== 401) {
      throw new Error("The CRM sign-in service is unavailable. Please check the server configuration.");
    }
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
      throw new Error("Cannot connect to the CRM server. Check your internet connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
