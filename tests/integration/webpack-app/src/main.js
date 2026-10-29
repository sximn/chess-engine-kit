import {
  API_VERSION,
  createFrozenight,
  frozenightAssetUrls,
} from "chess-engine-kit";

window.runEngineSmoke = async () => {
  const engine = createFrozenight();
  try {
    await engine.initialize();
    const result = await engine.analyzePosition({
      apiVersion: API_VERSION,
      jobId: "webpack",
      positionId: "opening",
      position: {
        rootFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        movesUci: [],
      },
      limits: { maxNodes: 10_000, maxDepth: 3 },
      multiPv: 3,
    });
    return {
      result,
      notices: Object.values(frozenightAssetUrls().notices).map(String),
    };
  } finally {
    engine.dispose();
  }
};
