/** The capture module's interface: a tab capture session (./screen), the synchronous PNG encoder (./png) and their contract. */
export { beginCapture } from './screen';
export { encodePng } from './png';
export { CaptureError, type CapturedImage, type CaptureRect, type CaptureSession, type CaptureStartResult } from './contract';
