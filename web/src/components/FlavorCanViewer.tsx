"use client";

import dynamic from "next/dynamic";
import type { Capsule } from "@/lib/data";

const SingleCanScene = dynamic(() => import("./SingleCanScene"), { ssr: false });

export default function FlavorCanViewer({ capsule }: { capsule: Capsule }) {
  return <SingleCanScene capsule={capsule} />;
}
