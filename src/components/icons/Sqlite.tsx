export function Sqlite({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="sqlite-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0F80CC" />
          <stop offset="100%" stopColor="#003B57" />
        </linearGradient>
      </defs>
      <path
        d="M56 0h144c30.928 0 56 25.072 56 56v144c0 30.928-25.072 56-56 56H56c-30.928 0-56-25.072-56-56V56C0 25.072 25.072 0 56 0z"
        fill="url(#sqlite-grad)"
      />
      <path
        d="M149 184c2.5 15.8 8 28 32 28 19.5 0 34-5.8 34-24 0-12.8-8-19.5-30-24.5l-20-4.8c-29-7-42-18-42-40 0-26.5 21.5-42 55-42 35.5 0 55 15 57 44h-28c-1.5-13-8.5-21.5-31-21.5-16 0-27 6-27 19 0 10 7 15 24 19l19.5 4.5c32 7.5 48 19 48 42 0 28-23 46.5-60 46.5-38 0-58-16.5-61-47h29.5z"
        fill="#FFF"
      />
    </svg>
  );
}
