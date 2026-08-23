import { generate as DefaultImage } from "@fumadocs/base-ui/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-identity";
import { ImageResponse } from "next/og";

export const revalidate = false;

/**
 * Homepage Open Graph image — same renderer as per-docs `/og/docs/…/image.png`.
 */
export function GET() {
  return new ImageResponse(
    <DefaultImage title={SITE_NAME} description={SITE_DESCRIPTION} site={SITE_NAME} />,
    {
      width: 1200,
      height: 630,
    },
  );
}
