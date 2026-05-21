import { type SVGProps } from "react";

export const ClickHouse = ({ className, ...props }: SVGProps<SVGSVGElement>) => {
  return (
    <svg {...props} className={`${className ?? ""} db-icon`} viewBox="27 24.5 100.1 100.1" fill="none" xmlns="http://www.w3.org/2000/svg">
      <title>ClickHouse</title>
      <path
        className="clickhouse-icon-path"
        d="m27 25.7c0-.6.5-1.2 1.2-1.2h8.8c.6 0 1.2.5 1.2 1.2v97.7c0 .6-.5 1.2-1.2 1.2h-8.8c-.6 0-1.2-.5-1.2-1.2zm22.2 0c0-.6.5-1.2 1.2-1.2h8.8c.6 0 1.2.5 1.2 1.2v97.7c0 .6-.5 1.2-1.2 1.2h-8.8c-.6 0-1.2-.5-1.2-1.2zm22.2 0c0-.6.5-1.2 1.2-1.2h8.8c.6 0 1.2.5 1.2 1.2v97.7c0 .6-.5 1.2-1.2 1.2h-8.8c-.6 0-1.2-.5-1.2-1.2zm22.2 0c0-.6.5-1.2 1.2-1.2h8.8c.6 0 1.2.5 1.2 1.2v97.7c0 .6-.5 1.2-1.2 1.2h-8.8c-.6 0-1.2-.5-1.2-1.2zm22.3 38.9c0-.6.5-1.2 1.2-1.2h8.8c.6 0 1.2.5 1.2 1.2v19.9c0 .6-.5 1.2-1.2 1.2h-8.8c-.6 0-1.2-.5-1.2-1.2z"
        fill="#161616"
      />
      <style>{`
        .clickhouse-icon-path { fill: #161616; }
        .dark .clickhouse-icon-path,
        html.dark .clickhouse-icon-path { fill: #fff; }
      `}</style>
    </svg>
  );
};
