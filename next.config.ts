import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The blog lives on the SynerWorlds hub — permanent (308) redirects,
      // mirroring cotuongup/checkers/caro. No Nonogram guide exists on the
      // hub yet, so every local blog URL lands on the Nonogram category
      // list (which renders its empty state until the bilingual guides are
      // imported there). These redirects are the /blog routes.
      {
        source: "/blog",
        destination: "https://synerworlds.com/blog?cat=nonogram",
        permanent: true,
      },
      {
        source: "/blog/:slug",
        destination: "https://synerworlds.com/blog?cat=nonogram",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
