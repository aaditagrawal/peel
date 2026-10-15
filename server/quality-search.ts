type Candidate<T> = { value: T; fits: boolean; bytes: number };

/** Keep the best measured result while bounding expensive encoder calls. */
export async function findFittingQuality<T>(
  encode: (quality: number) => Promise<Candidate<T>>,
  limit: number,
  minimum = 30,
  maximum = 100,
) {
  let attempts = 0;
  const samples: { quality: number; fits: boolean; bytes: number }[] = [];
  let best: { value: T; quality: number } | undefined;
  const probe = async (quality: number) => {
    attempts++;
    const candidate = await encode(quality);
    samples.push({ quality, fits: candidate.fits, bytes: candidate.bytes });
    if (candidate.fits && (!best || quality > best.quality))
      best = { value: candidate.value, quality };
    return candidate.fits;
  };
  if (await probe(maximum)) return best;
  if (!(await probe(minimum))) {
    // WebP sizes are not strictly monotonic. A failed low endpoint does not
    // prove that every higher quality fails: check two interior qualities too.
    for (const fraction of [0.5, 0.8]) {
      const quality = Math.round(minimum + (maximum - minimum) * fraction);
      await probe(quality);
    }
    if (!best) return undefined;
  }
  while (best && attempts < 6) {
    const current = best;
    const low = samples.find((sample) => sample.quality === current.quality);
    if (!low) break;
    const high = samples
      .filter((sample) => !sample.fits && sample.quality > low.quality)
      .sort((a, b) => a.quality - b.quality)[0];
    if (!high || high.quality - low.quality <= 1 || low.bytes >= limit * 0.98)
      break;
    let quality = Math.round((low.quality + high.quality) / 2);
    if (low.bytes < limit && high.bytes > limit) {
      // Size grows steeply near quality 100. Interpolate in log size and log
      // distance from 101, then verify the result instead of trusting the model.
      const ratio =
        Math.log((limit * 0.995) / low.bytes) /
        Math.log(high.bytes / low.bytes);
      quality = Math.round(
        101 -
          Math.exp(
            Math.log(101 - low.quality) +
              ratio *
                (Math.log(101 - high.quality) - Math.log(101 - low.quality)),
          ),
      );
    }
    await probe(Math.max(low.quality + 1, Math.min(high.quality - 1, quality)));
  }
  return best;
}
