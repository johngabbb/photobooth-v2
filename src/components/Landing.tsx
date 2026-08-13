import Image from "next/image";
import { SessionActions } from "@/components/SessionActions";
import { BRAND_ASSETS } from "@/lib/brand";

export function Landing() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-6 text-center">
      <Image
        src={BRAND_ASSETS.logo}
        alt="pamkin photo bee"
        width={581}
        height={864}
        priority
        className="max-h-[38vh] w-auto"
      />

      <p className="max-w-md text-sm leading-relaxed text-ink/60">
        A photobooth for two. Open it on both your phones, and one countdown takes a
        picture on each — every frame has both of you in it.
      </p>

      <SessionActions showSolo />
    </div>
  );
}
