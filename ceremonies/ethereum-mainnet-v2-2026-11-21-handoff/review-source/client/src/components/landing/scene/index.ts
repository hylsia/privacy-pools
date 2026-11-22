/**
 * Scene kit for the landing page v2 ("Immersive scenes"; spec: scene-spec.md).
 * Import everything from "@/components/landing/scene".
 *
 *   Depth      SceneStage, SceneLayer, useSceneDepth, useScene, DEPTH, SCENE_DEPTHS
 *   Sky        NightSky, Moon, SceneSparkles (+ Starfield, Sparkle, Ribbons, CrescentMoon from sky.tsx)
 *   Land       Ridge, Ridges
 *   Clouds     CloudDeck, CloudIsland, CloudWall (NEAR_BANDS, WIPE_BANDS), CloudWipe, CloudSeam
 *              (+ CloudBank from sky.tsx)
 *   Pool       Monoliths, Diamond
 *   Air        Fog, FogBand, Constellation
 *   Overlays   Grain (once, in Landing), Vignette, Scrim
 *   Geometry   rng, scatter, splinePath, ridgePaths, scallopPaths
 *
 * Type over scenes lives in system.tsx: SCENE_TYPE, SCENE_CTA_PRIMARY, SCENE_CTA_SECONDARY.
 */
import "./scene.css";

export * from "./depth";
export * from "./NightSky";
export * from "./Ridges";
export * from "./Clouds";
export * from "./Monoliths";
export * from "./Atmosphere";
export { SCENE_W, islandPaths, rng, ridgePaths, scallopPaths, scatter, splinePath } from "./geometry";
export { CloudBank, CrescentMoon, Ribbons, Sparkle, Starfield, type Puff } from "@/components/landing/sky";
