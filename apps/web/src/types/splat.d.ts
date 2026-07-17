declare module "@mkkellogg/gaussian-splats-3d" {
  import * as THREE from "three";
  export class Viewer {
    constructor(opts: {
      camera: THREE.Camera;
      renderer: THREE.WebGLRenderer;
      useBuiltInControls?: boolean;
      selfDrivenMode?: boolean;
      ignoreDevicePixelRatio?: boolean;
      [key: string]: unknown;
    });
    domElement: HTMLCanvasElement;
    addSplatScene(
      path: string,
      options?: Record<string, unknown>,
    ): Promise<void>;
    dispose(): void;
  }
  const _default: { Viewer: typeof Viewer };
  export default _default;
}
