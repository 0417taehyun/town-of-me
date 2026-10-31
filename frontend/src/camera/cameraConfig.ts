export type CameraSettings = {
  fov: number
  height: number
  distance: number
  positionFollowSpeed: number
  targetFollowSpeed: number
  lookAhead: number
  maxYaw: number
  maxPitch: number
  yawReturnSpeed: number
}

export const CAMERA_EYE_TARGET_HEIGHT = 1.65

export const CAMERA_DEFAULTS: CameraSettings = {
  fov: 44,
  height: 1.7,
  distance: 10.5,
  positionFollowSpeed: 7.5,
  targetFollowSpeed: 7.5,
  lookAhead: 0.8,
  maxYaw: 90,
  maxPitch: 62,
  yawReturnSpeed: 1.5,
}
