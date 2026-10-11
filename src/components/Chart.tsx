interface Series {
  values: (number | null)[];
  color: string;
  fill?: boolean;
}
export function Chart({
  series,
  label,
  large = false,
}: {
  series: Series[];
  label: string;
  large?: boolean;
}) {
  const width = 160,
    height = large ? 120 : 56,
    slots = 60;
  const paths = (values: (number | null)[]) => {
    const segments: string[] = [];
    let active = "";
    values.forEach((value, index) => {
      if (value === null) {
        if (active) segments.push(active);
        active = "";
        return;
      }
      const x = ((slots - values.length + index) / (slots - 1)) * width;
      const y = height - (value / 100) * (height - 4);
      active += `${active ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    });
    if (active) segments.push(active);
    return segments;
  };
  return (
    <svg
      className={`chart ${large ? "large-chart" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {series.map((line, i) => (
        <g key={i}>
          {paths(line.values).map((path, j) => {
            const points = path.match(/[\d.]+,[\d.]+/g)!;
            const firstX = points[0].split(",")[0],
              lastX = points[points.length - 1].split(",")[0];
            return (
              <g key={j}>
                {line.fill && (
                  <path
                    d={`${path} L${lastX},${height} L${firstX},${height} Z`}
                    fill={line.color}
                    opacity=".95"
                  />
                )}
                <path
                  d={path}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={large ? ".9" : "1.5"}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
