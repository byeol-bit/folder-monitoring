import fs from 'fs';
import path from 'path';

interface FileInfo {
  name: string;
  size: number;
  lastModified: Date;
}

/**
 * 폴더 내에서 가장 최근에 수정된 파일의 정보를 반환합니다.
 * @param folderPath 검색할 폴더 경로
 * @returns 가장 최근에 수정된 파일의 정보 (파일명, 크기, 수정일)
 */
export function getLatestModifiedFile(folderPath: string): FileInfo | null {
  try {
    // 폴더 존재 여부 확인
    if (!fs.existsSync(folderPath)) {
      throw new Error(`폴더가 존재하지 않습니다: ${folderPath}`);
    }

    // 폴더 내의 모든 파일과 디렉토리 목록 가져오기
    const items = fs.readdirSync(folderPath);
    let latestFile: FileInfo | null = null;

    for (const item of items) {
      const fullPath = path.join(folderPath, item);
      
      try {
        const stat = fs.statSync(fullPath);
        
        // 파일인 경우에만 처리
        if (stat.isFile()) {
          const fileInfo: FileInfo = {
            name: item,
            size: stat.size,
            lastModified: stat.mtime
          };

          // 최신 파일 정보 업데이트
          if (!latestFile || fileInfo.lastModified > latestFile.lastModified) {
            latestFile = fileInfo;
          }
        }
      } catch (error) {
        console.error(`파일 정보를 가져오는 중 오류 발생 (${fullPath}):`, error);
        continue;
      }
    }

    return latestFile;
  } catch (error) {
    console.error(`폴더 검색 중 오류 발생 (${folderPath}):`, error);
    return null;
  }
}

/**
 * 파일 크기를 사람이 읽기 쉬운 형식으로 변환합니다.
 * @param bytes 파일 크기 (바이트)
 * @returns 변환된 크기 문자열 (예: "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
} 