import { cn } from "@/lib/utils";

interface LipiVoiceLogoProps {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  size?: "sm" | "md";
}

export function LipiVoiceLogo({
  className,
  markClassName,
  showWordmark = true,
  size = "md",
}: LipiVoiceLogoProps) {
  const isSmall = size === "sm";

  return (
    <div className={cn("inline-flex min-w-0 items-center gap-2.5", className)} aria-label="LipiVoice">
      <LipiVoiceMark
        className={cn(isSmall ? "h-8 w-8" : "h-10 w-10", markClassName)}
        title={showWordmark ? undefined : "LipiVoice"}
      />
      {showWordmark ? (
        <div className="min-w-0 leading-none">
          <div
            className={cn(
              "truncate font-semibold tracking-normal text-brand-ink",
              isSmall ? "text-lg" : "text-xl",
            )}
          >
            Lipi<span className="bg-brand-voice-gradient bg-clip-text text-transparent">Voice</span>
          </div>
          <div className="mt-1 truncate text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Self-hosted voice AI
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LipiVoiceMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={cn("shrink-0", className)} viewBox="0 0 64 64" role="img" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="lipivoice-wall" x1="14" y1="12" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#07183A" />
          <stop offset="1" stopColor="#102C68" />
        </linearGradient>
        <linearGradient id="lipivoice-floor" x1="19" y1="50" x2="54" y2="39" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3E31CA" />
          <stop offset="1" stopColor="#6A56F2" />
        </linearGradient>
        <linearGradient id="lipivoice-wave" x1="37" y1="18" x2="52" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7B61FF" />
          <stop offset="1" stopColor="#4936D8" />
        </linearGradient>
      </defs>
      <path d="M14 18.5 35.5 4.5v39L14 58V18.5Z" fill="url(#lipivoice-wall)" />
      <path d="M14 58 35.5 43.5H57L40.5 60H19L14 58Z" fill="url(#lipivoice-floor)" />
      <rect x="39" y="26" width="4.7" height="13" rx="2.35" fill="url(#lipivoice-wave)" />
      <rect x="47" y="20" width="4.7" height="25" rx="2.35" fill="url(#lipivoice-wave)" />
      <rect x="55" y="27" width="4.7" height="12" rx="2.35" fill="url(#lipivoice-wave)" />
      <rect x="31" y="30" width="4.7" height="8" rx="2.35" fill="url(#lipivoice-wave)" />
    </svg>
  );
}
