import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

const PROFILE_PHOTO_KEY = 'dalli.profile-photo-uri';

export async function getProfilePhotoUri() {
  const uri = await SecureStore.getItemAsync(PROFILE_PHOTO_KEY);
  if (!uri) return null;
  const file = await FileSystem.getInfoAsync(uri);
  if (file.exists) return uri;
  await SecureStore.deleteItemAsync(PROFILE_PHOTO_KEY);
  return null;
}

export function setProfilePhotoUri(uri: string) {
  return SecureStore.setItemAsync(PROFILE_PHOTO_KEY, uri);
}
