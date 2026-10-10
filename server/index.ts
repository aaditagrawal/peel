import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { convertSticker } from "./convert";
import { convertVideo } from "./video";

const app = new Hono();
const origins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:8081,http://127.0.0.1:8081"
).split(",");
app.use("*", cors({ origin: origins }));
app.use(
  "*",
  bodyLimit({
    maxSize: 101 * 1024 * 1024,
    onError: (c) =>
      c.json({ error: "Choose a file smaller than 100 MB." }, 413),
  }),
);
app.get("/health", (c) => c.json({ status: "ok" }));
let active = 0;
app.post("/convert", async (c) => {
  if (active >= 2)
    return c.json(
      { error: "The converter is busy. Please try again in a moment." },
      429,
    );
  active++;
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === "string" || !(file instanceof File))
      return c.json({ error: "Choose an image first." }, 400);
    const input = Buffer.from(await file.arrayBuffer());
    const isVideo =
      file.type.startsWith("video/") ||
      /\.(mp4|mov|webm|m4v)$/i.test(file.name);
    const result = isVideo
      ? await convertVideo(
          input,
          Number(body.start || 0),
          Number(body.duration || 3),
        )
      : await convertSticker(input);
    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not convert that image.",
      },
      422,
    );
  } finally {
    active--;
  }
});
serve({
  fetch: app.fetch,
  port: Number(process.env.PORT || 4311),
  hostname: "0.0.0.0",
});
console.log("Peel converter listening on port " + (process.env.PORT || 4311));
