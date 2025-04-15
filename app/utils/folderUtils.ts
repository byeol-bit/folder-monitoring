import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FolderInfo {
  path: string;
  size: number;
  folderCount: number;
  fileCount: number;
  subFolders: FolderInfo[];
}

// 접근이 제한된 폴더 목록
const RESTRICTED_FOLDERS = ['$RECYCLE.BIN', 'System Volume Information'];

export async function getFolderInfo(folderPath: string): Promise<FolderInfo> {
  console.log(`\n${folderPath} 폴더를 스캔 중...`);
  
  try {
    const stats = await fs.promises.stat(folderPath);
    const info: FolderInfo = {
      path: folderPath,
      size: stats.size,
      folderCount: 0,
      fileCount: 0,
      subFolders: []
    };

    const items = await fs.promises.readdir(folderPath);
    console.log(`총 ${items.length}개의 항목을 발견했습니다.`);
    
    for (const item of items) {
      // 시스템 폴더는 건너뛰기
      if (RESTRICTED_FOLDERS.includes(item)) {
        console.log(`시스템 폴더 ${item} 건너뜀`);
        continue;
      }

      const itemPath = path.join(folderPath, item);
      try {
        const itemStats = await fs.promises.stat(itemPath);
        
        if (itemStats.isDirectory()) {
          info.folderCount++;
          try {
            const subFolderInfo = await getFolderInfo(itemPath);
            info.subFolders.push(subFolderInfo);
            info.size += subFolderInfo.size;
            info.fileCount += subFolderInfo.fileCount;
          } catch (error: unknown) {
            // 하위 폴더 접근 에러는 무시하고 계속 진행
            console.log(`경고: ${itemPath} 폴더에 접근할 수 없습니다. 건너뜁니다.`);
          }
        } else {
          info.fileCount++;
          info.size += itemStats.size;
          if (info.fileCount % 1000 === 0) {
            console.log(`${info.fileCount}개의 파일 처리 중...`);
          }
        }
      } catch (error: unknown) {
        // 파일/폴더 접근 에러는 무시하고 계속 진행
        console.log(`경고: ${itemPath}에 접근할 수 없습니다. 건너뜁니다.`);
      }
    }

    console.log(`${folderPath} 폴더 스캔 완료`);
    return info;
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`폴더 정보를 가져오는 중 오류가 발생했습니다: ${error.message}`);
    } else {
      throw new Error('알 수 없는 오류가 발생했습니다.');
    }
  }
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
} 