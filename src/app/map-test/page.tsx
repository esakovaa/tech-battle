"use client";

import dynamic from "next/dynamic";

const KiezMap = dynamic(() => import("@/components/KiezMap"), { ssr: false });

export default function MapTestPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>KiezMap test — Helmholtzplatz</h1>
      <KiezMap plrId="03601347" height={500} />
    </div>
  );
}
