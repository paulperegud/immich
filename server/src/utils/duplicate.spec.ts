import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { ExifResponseSchema } from 'src/dtos/exif.dto.js';
import { AssetType, AssetVisibility } from 'src/enum.js';
import {
  getExifCount,
  isDeviceOriginalFormat,
  suggestDuplicate,
  suggestDuplicateKeepAssetIds,
} from 'src/utils/duplicate.js';

type ExifInfoInput = Partial<z.infer<typeof ExifResponseSchema>>;

const createAsset = (
  id: string,
  fileSizeInByte: number | null = null,
  exifFields: ExifInfoInput = {},
  originalFileName = 'asset.jpg',
): AssetResponseDto => ({
  id,
  type: AssetType.Image,
  thumbhash: null,
  localDateTime: new Date().toISOString(),
  duration: 0,
  hasMetadata: true,
  width: 1920,
  height: 1080,
  createdAt: new Date().toISOString(),
  ownerId: 'owner-1',
  originalPath: '/path/to/asset',
  originalFileName,
  fileCreatedAt: new Date().toISOString(),
  fileModifiedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isFavorite: false,
  isArchived: false,
  isTrashed: false,
  isOffline: false,
  isEdited: false,
  visibility: AssetVisibility.Timeline,
  checksum: 'checksum',
  exifInfo:
    fileSizeInByte !== null || Object.keys(exifFields).length > 0
      ? ExifResponseSchema.parse({ fileSizeInByte, ...exifFields })
      : undefined,
});

describe('duplicate utils', () => {
  describe('getExifCount', () => {
    it('should return 0 for asset without exifInfo', () => {
      const asset = createAsset('asset-1');
      asset.exifInfo = undefined;
      expect(getExifCount(asset)).toBe(0);
    });

    it('should return 0 for empty exifInfo', () => {
      const asset = createAsset('asset-1');
      asset.exifInfo = ExifResponseSchema.parse({});
      expect(getExifCount(asset)).toBe(0);
    });

    it('should count all truthy values in exifInfo', () => {
      const asset = createAsset('asset-1', 1000, {
        make: 'Canon',
        model: 'EOS 5D',
        dateTimeOriginal: new Date().toISOString(),
        timeZone: 'UTC',
        latitude: 40.7128,
        longitude: -74.006,
        city: 'New York',
        state: 'NY',
        country: 'USA',
        description: 'A photo',
        rating: 5,
      });
      // fileSizeInByte (1000) + 11 other truthy fields = 12
      expect(getExifCount(asset)).toBe(12);
    });

    it('should not count null or undefined values', () => {
      const asset = createAsset('asset-1', 1000, {
        make: 'Canon',
        model: null,
        latitude: undefined,
        city: '',
        rating: null,
      });
      // fileSizeInByte (1000) + make ('Canon') = 2 truthy values
      // model (null), latitude (undefined), city (''), rating (0) are all falsy
      expect(getExifCount(asset)).toBe(2);
    });
  });

  describe('isDeviceOriginalFormat', () => {
    it('should return true for HEIC', () => {
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.HEIC'))).toBe(true);
    });

    it('should return true for HEIF and HIF', () => {
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.heif'))).toBe(true);
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.hif'))).toBe(true);
    });

    it('should ignore extension case', () => {
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.hEiC'))).toBe(true);
    });

    it('should return false for converted formats', () => {
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.jpg'))).toBe(false);
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.jpeg'))).toBe(false);
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032.png'))).toBe(false);
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4034.mp4'))).toBe(false);
    });

    it('should return false for file names without an extension', () => {
      expect(isDeviceOriginalFormat(createAsset('asset-1', 1000, {}, 'IMG_4032'))).toBe(false);
    });
  });

  describe('suggestDuplicate', () => {
    it('should return undefined for empty list', () => {
      expect(suggestDuplicate([])).toBeUndefined();
    });

    it('should return the single asset for list with one asset', () => {
      const asset = createAsset('asset-1', 1000);
      expect(suggestDuplicate([asset])).toEqual(asset);
    });

    it('should return the asset with the most EXIF data regardless of file size', () => {
      const largeWithLessExif = createAsset('large-less-exif', 5000, { make: 'Canon' });
      const smallWithMoreExif = createAsset('small-more-exif', 1000, {
        make: 'Canon',
        model: 'EOS 5D',
        city: 'New York',
      });

      // EXIF counts: 2 vs 4
      expect(suggestDuplicate([largeWithLessExif, smallWithMoreExif])?.id).toBe('small-more-exif');
      expect(suggestDuplicate([smallWithMoreExif, largeWithLessExif])?.id).toBe('small-more-exif');
    });

    it('should use file size as tie-breaker when EXIF counts and formats are equal', () => {
      const small = createAsset('small', 1000);
      const large = createAsset('large', 5000);
      const medium = createAsset('medium', 3000);

      // All have an EXIF count of 1 (only fileSizeInByte) and the same format
      expect(suggestDuplicate([small, large, medium])?.id).toBe('large');
      expect(suggestDuplicate([large, small, medium])?.id).toBe('large');
      expect(suggestDuplicate([medium, small, large])?.id).toBe('large');
    });

    it('should prefer device original format (HEIC) over converted copy when EXIF counts are equal', () => {
      const heic = createAsset('heic', 1000, {}, 'IMG_4032.HEIC');
      const jpeg = createAsset('jpeg', 5000, {}, 'IMG_4032.jpg');

      // HEIC wins even though it is smaller
      expect(suggestDuplicate([heic, jpeg])?.id).toBe('heic');
      expect(suggestDuplicate([jpeg, heic])?.id).toBe('heic');
    });

    it('should treat HEIF and HIF as device original formats', () => {
      const heif = createAsset('heif', 1000, {}, 'IMG_4032.heif');
      const hif = createAsset('hif', 1000, {}, 'IMG_4032.hif');
      const jpeg = createAsset('jpeg', 5000, {}, 'IMG_4032.jpeg');

      expect(suggestDuplicate([jpeg, heif])?.id).toBe('heif');
      expect(suggestDuplicate([jpeg, hif])?.id).toBe('hif');
    });

    it('should fall back to file size when all assets are in device original format', () => {
      const smallHeic = createAsset('small-heic', 1000, {}, 'IMG_1.HEIC');
      const largeHeic = createAsset('large-heic', 5000, {}, 'IMG_2.HEIC');

      expect(suggestDuplicate([smallHeic, largeHeic])?.id).toBe('large-heic');
    });

    it('should fall back to file size when no asset is in device original format', () => {
      const png = createAsset('png', 1000, {}, 'IMG_1.png');
      const jpeg = createAsset('jpeg', 5000, {}, 'IMG_2.jpg');

      expect(suggestDuplicate([png, jpeg])?.id).toBe('jpeg');
    });

    it('should prioritize EXIF count over device original format', () => {
      const heicWithLessExif = createAsset('heic-less-exif', 5000, {}, 'IMG_4032.HEIC');
      const jpegWithMoreExif = createAsset(
        'jpeg-more-exif',
        1000,
        { make: 'Canon', model: 'iPhone 16 Pro' },
        'IMG_4032.jpg',
      );

      // EXIF counts: 1 vs 3
      expect(suggestDuplicate([heicWithLessExif, jpegWithMoreExif])?.id).toBe('jpeg-more-exif');
    });

    it('should apply criteria in order: EXIF data, device format, then file size', () => {
      const hugeJpgWithoutExif = createAsset('huge-jpg', 10_000, {}, 'IMG_1.jpg'); // EXIF count 1
      const largeJpg = createAsset('large-jpg', 9000, { make: 'Canon' }, 'IMG_2.jpg'); // EXIF count 2
      const heic = createAsset('heic', 8000, { make: 'Canon' }, 'IMG_3.HEIC'); // EXIF count 2

      // huge-jpg is eliminated by EXIF count, then HEIC beats the equally sized JPEG copy
      expect(suggestDuplicate([hugeJpgWithoutExif, largeJpg, heic])?.id).toBe('heic');
    });

    it('should handle assets with no exifInfo (treated as having no metadata)', () => {
      const noExif = createAsset('no-exif');
      noExif.exifInfo = undefined;
      const withExif = createAsset('with-exif', 1000);

      expect(suggestDuplicate([noExif, withExif])?.id).toBe('with-exif');
    });

    it('should prefer asset with more metadata even when it has no file size', () => {
      const noFileSize = createAsset('no-file-size');
      noFileSize.exifInfo = ExifResponseSchema.parse({ make: 'Canon', model: 'EOS 5D' });
      const withFileSize = createAsset('with-file-size', 1000);

      // EXIF counts: 2 (make + model) vs 1 (fileSizeInByte)
      expect(suggestDuplicate([noFileSize, withFileSize])?.id).toBe('no-file-size');
    });

    it('should return the last asset when all criteria are tied', () => {
      const asset1 = createAsset('asset-1', 1000, { make: 'Canon' });
      const asset2 = createAsset('asset-2', 1000, { make: 'Nikon' });

      // Both have the same EXIF count (2), format and file size; the sort is
      // stable, so the last asset in the input order wins
      expect(suggestDuplicate([asset1, asset2])?.id).toBe('asset-2');
    });
  });

  describe('suggestDuplicateKeepAssetIds', () => {
    it('should return empty array for empty list', () => {
      expect(suggestDuplicateKeepAssetIds([])).toEqual([]);
    });

    it('should return array with single asset ID', () => {
      const asset = createAsset('asset-1', 1000);
      expect(suggestDuplicateKeepAssetIds([asset])).toEqual(['asset-1']);
    });

    it('should return array with best asset ID based on file size', () => {
      const small = createAsset('small', 1000);
      const large = createAsset('large', 5000);

      expect(suggestDuplicateKeepAssetIds([small, large])).toEqual(['large']);
    });

    it('should return array with best asset ID based on metadata', () => {
      const withLessExif = createAsset('less-exif', 5000, { make: 'Canon' });
      const withMoreExif = createAsset('more-exif', 1000, { make: 'Canon', model: 'EOS 5D' });

      expect(suggestDuplicateKeepAssetIds([withLessExif, withMoreExif])).toEqual(['more-exif']);
    });
  });
});
