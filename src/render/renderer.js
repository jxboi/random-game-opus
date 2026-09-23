// ---------------------------------------------------------------------------
// Renderer contract and factory.
//
// A renderer draws a World plus the UI's transient state. It must never
// mutate either. Two implementations exist:
//   '3d'  src/render/three/renderer3d.js  three.js scene (default)
//   '2d'  src/render/renderer2d.js        classic top-down canvas (fallback)
//
// Coordinates: the simulation works in tiles. Tile (x, y) covers
// [x, x+1) × [y, y+1); +x is east, +y is south. Screen coordinates are CSS
// pixels relative to the #stage element.
//
// Every renderer implements:
//   kind                          '2d' | '3d'
//   cam = { x, y, zoom }          camera target in tiles; zoom 1 = default
//   cw, ch                        stage size in CSS px
//   view = { tx0, ty0, tx1, ty1 } visible tile bounds, for culling
//   setWorld(world)               switch to another World (new game / load)
//   resize()                      stage size changed
//   draw(alpha, uiState, dt)      alpha = interpolation 0..1 between ticks
//   toScreen(x, y, h = 0)         tile coords (+ h tiles above the ground) -> [sx, sy]
//   toWorld(sx, sy)               screen -> [x, y] tile coords on the ground
//   pxPerTile()                   approx on-screen size of a tile at the view centre
//   panBy(dx, dy)                 drag the view by screen pixels
//   zoomAt(sx, sy, factor)        zoom keeping the point under the cursor fixed
//   clampCam()                    keep the camera on the map
//   pickBuilding(sx, sy)          building id under the cursor (0 if unknown)
//   viewPolygon()                 4 ground points of the screen corners (minimap)
//   flash(x, y, rgbaWithA)        order acknowledgement ring; 'A' is replaced by alpha
//   floater(x, y, icon)           rising emoji over a spot (production feedback)
//   dispose()                     remove canvases and free GPU resources
//
// uiState fields a renderer reads (see UI.state in src/ui/ui.js):
//   selGroups:Set, selBuilding, selUnit, hoverBuilding, box, ghost, showEnemyPlans
// ---------------------------------------------------------------------------
import { Renderer2D } from './renderer2d.js';

export const RENDERERS = { '3d': 'three.js 3D', '2d': 'Classic 2D' };

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

// The 3D renderer is loaded on demand so the 2D fallback works even if
// three.js fails to load.
export async function createRenderer(kind, stage, world) {
  if (kind === '3d' && webglAvailable()) {
    try {
      const mod = await import('./three/renderer3d.js');
      return new mod.Renderer3D(stage, world);
    } catch (e) {
      console.error('3D renderer failed, falling back to 2D:', e);
    }
  }
  return new Renderer2D(stage, world);
}
