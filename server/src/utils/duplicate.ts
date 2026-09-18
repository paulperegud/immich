import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { getFilenameExtension } from 'src/utils/file.js';

/**
Counts all truthy values in the exifInfo object.

@param asset Asset with optional exifInfo
@returns Count of truthy EXIF values
*/
export const getExifCount = (asset: AssetResponseDto): number => {
  return Object.values(asset.exifInfo ?? {}).filter(Boolean).length;
};

/**
File extensions that the capturing device stores on disk, as opposed to
converted copies (e.g. JPEG) that are produced when sharing or exporting.
HEIC/HEIF is what modern phones, the iPhone in particular, produce.
Extend this list to treat additional formats (e.g. RAW) as device originals.
*/
const deviceOriginalExtensions = new Set(['.heic', '.heif', '.hif']);

/**
Returns whether the asset is stored in its original device format (e.g. HEIC),
rather than a converted copy (e.g. JPEG).

@param asset Asset with an original file name
@returns True if the file extension is a device-original format
*/
export const isDeviceOriginalFormat = (asset: AssetResponseDto): boolean => {
  return deviceOriginalExtensions.has(getFilenameExtension(asset.originalFileName).toLowerCase());
};

/**
Suggests the best duplicate asset to keep from a list of duplicates.
Fork note: upstream Immich prioritizes the largest file first, with EXIF data as tie-breaker.

The best asset is determined by the following criteria:
 1. Largest count of EXIF data
 2. File stored in its original device format (e.g. HEIC over a converted JPEG)
 3. Largest image file size in bytes (as tie-breaker)

@param assets List of duplicate assets
@returns The best asset to keep, or undefined if empty list
*/
export const suggestDuplicate = (assets: AssetResponseDto[]): AssetResponseDto | undefined => {
  if (assets.length === 0) {
    return undefined;
  }

  // Sort by preference ascending (least preferred first), then return the last element
  return assets
    .toSorted((a, b) => {
      // 1. Prefer the asset with more EXIF metadata
      const exifCountDiff = getExifCount(a) - getExifCount(b);
      if (exifCountDiff !== 0) {
        return exifCountDiff;
      }

      // 2. Prefer the file in its original device format (e.g. HEIC over a converted JPEG)
      const aIsDeviceOriginal = isDeviceOriginalFormat(a);
      const bIsDeviceOriginal = isDeviceOriginalFormat(b);
      if (aIsDeviceOriginal !== bIsDeviceOriginal) {
        return aIsDeviceOriginal ? 1 : -1;
      }

      // 3. Prefer the larger file
      return (a.exifInfo?.fileSizeInByte ?? 0) - (b.exifInfo?.fileSizeInByte ?? 0);
    })
    .at(-1);
};

/**
Suggests the best duplicate asset IDs to keep from a list of duplicates.
Returns an array with a single asset ID (the best candidate), or empty if no assets.

@param assets List of duplicate assets
@returns Array of suggested asset IDs to keep (0 or 1 element)
*/
export const suggestDuplicateKeepAssetIds = (assets: AssetResponseDto[]): string[] => {
  const suggested = suggestDuplicate(assets);
  return suggested ? [suggested.id] : [];
};
