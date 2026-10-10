/** Keep native bridge wrappers and Java class names out of user-facing errors. */
export function conversionError(error: unknown): string {
  const fallback = "Couldn't import this file. Try again.";
  if (!(error instanceof Error)) return fallback;
  const message =
    error.message
      .split(/(?:→\s*)?Caused by:\s*/)
      .at(-1)
      ?.trim()
      .replace(/^[\w.$]+(?:Exception|Error):\s*/, "") || "";
  if (message.startsWith("WhatsApp ") && message.length < 250) return message;
  if (/could not encode|encoder|outofmemory|allocation/i.test(message))
    return fallback;
  if (
    /^(WhatsApp |Choose |This |Images |GIF |GIFs |Unsupported image|Android could not decode|The clip |Could not open|Could not read|Could not decode|Could not reach|Install |For animation|Images must)/.test(
      message,
    ) &&
    message.length < 250
  )
    return message;
  return fallback;
}
