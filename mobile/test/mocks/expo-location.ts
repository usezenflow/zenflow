export const Accuracy = { Balanced: 3 };
export async function requestForegroundPermissionsAsync() {
  return { granted: false };
}
export async function getCurrentPositionAsync() {
  return { coords: { latitude: 11.9558, longitude: 108.4437 } };
}
