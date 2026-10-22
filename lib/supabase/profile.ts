"use client";

import { createClient } from "./client";

/** Editable profile fields on the SHARED `profiles` table (same columns
 *  Chess/PacClone use — never recreate them; there is NO email column,
 *  email comes from the auth session). */
export interface MyProfile {
  id: string;
  username: string | null;
  full_name: string | null;
  birth_date: string | null; // YYYY-MM-DD
  avatar_url: string | null;
  city: string | null;
  country: string | null;
}

export interface MyProfileUpdate {
  full_name?: string | null;
  birth_date?: string | null;
  avatar_url?: string | null;
  city?: string | null;
  country?: string | null;
}

export async function fetchMyProfile(): Promise<MyProfile | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, full_name, birth_date, avatar_url, city, country")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as MyProfile;
}

/** Returns an error message, or null on success. */
export async function updateMyProfile(
  patch: MyProfileUpdate
): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Not logged in";
  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);
  return error ? error.message : null;
}

/** Upload a new avatar to the user's own folder in the shared `avatars`
 *  bucket (same bucket/policies as Chess) and return its public URL. */
export async function uploadAvatar(
  file: File
): Promise<{ url?: string; error?: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not logged in" };
  if (!file.type.startsWith("image/"))
    return { error: "Not an image file" };
  if (file.size > 5 * 1024 * 1024)
    return { error: "Image must be under 5 MB" };
  const path = `${user.id}/avatar`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) return { error: error.message };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: `${data.publicUrl}?v=${Date.now()}` };
}

/** Change the signed-in user's password. Returns an error message or null. */
export async function changePassword(
  newPassword: string
): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  return error ? error.message : null;
}
