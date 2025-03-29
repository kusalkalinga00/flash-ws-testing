"use client";
import React from "react";
import dynamic from "next/dynamic";

const ConnectionInd = dynamic(
  () => import("@/app/_custom-components/ConnectionInd"),
  {
    ssr: false,
  }
);

const HomeView = () => {
  return <ConnectionInd />;
};

export default HomeView;
