import { Client, SFTPWrapper } from 'ssh2';
import fs from 'fs';
import path from 'path';
import { getLatestModifiedFile, formatFileSize } from '../app/utils/fileUtils';

interface Config {
  folderPath: string;
  sftp: {
    host: string;
    port: number;
    username: string;
    password: string;
    remotePath: string;
  };
}

interface FolderInfo {
  path: string;
  size: number;
  fileCount: number;
  subFolders: FolderInfo[];
  latestFile?: {
    name: string;
    size: number;
    lastModified: string;
  };
}

// 접근이 제한된 시스템 폴더 목록
const RESTRICTED_FOLDERS = [
  'Recovery',
  'System Volume Information',
  '$RECYCLE.BIN',
  'Config.Msi',
  'Documents and Settings',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
  'Windows',
  'Windows.old'
];

function loadConfig(): Config {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('config.json 파일이 존재하지 않습니다.');
    }

    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData) as Config;

    // 필수 설정값 검증
    if (!config.folderPath || !config.sftp.host || !config.sftp.username || !config.sftp.password) {
      throw new Error('필수 설정값이 누락되었습니다.');
    }

    return config;
  } catch (error) {
    console.error('설정 파일 로드 중 오류 발생:', error);
    process.exit(1);
  }
}

async function collectFolderInfo(folderPath: string): Promise<FolderInfo> {
  console.log(`\n${folderPath} 폴더 정보를 수집 중...`);
  
  const info: FolderInfo = {
    path: folderPath,
    size: 0,
    fileCount: 0,
    subFolders: []
  };

  try {
    const items = fs.readdirSync(folderPath);
    for (const item of items) {
      const fullPath = path.join(folderPath, item);
      
      // 시스템 폴더 체크
      if (RESTRICTED_FOLDERS.includes(item)) {
        console.log(`시스템 폴더 ${fullPath} 건너뜀`);
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          const subFolderInfo = await collectFolderInfo(fullPath);
          info.subFolders.push(subFolderInfo);
          info.size += subFolderInfo.size;
          info.fileCount += subFolderInfo.fileCount;
        } else {
          info.size += stat.size;
          info.fileCount++;
        }
      } catch (error) {
        console.log(`경고: ${fullPath}에 접근할 수 없습니다. 건너뜁니다.`);
      }
    }

    // 하위 폴더가 없는 경우 또는 가장 최근에 수정된 파일 정보 추가
    const latestFile = getLatestModifiedFile(folderPath);
    if (latestFile) {
      info.latestFile = latestFile;
    }
  } catch (error) {
    console.log(`경고: ${folderPath} 폴더에 접근할 수 없습니다. 건너뜁니다.`);
  }

  return info;
}

async function transferFolderInfo(config: Config) {
  console.log(`\n${config.folderPath} 폴더 정보를 수집하고 있습니다...`);
  
  const folderInfo = await collectFolderInfo(config.folderPath);
  const jsonData = JSON.stringify(folderInfo, null, 2);
  
  // 현재 시간을 포함한 파일명 생성
  const now = new Date();
  const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9 (한국 시간)
  const timestamp = koreaTime.toISOString()
    .replace(/[-T:]/g, '')
    .slice(0, 12); // yyyyMMddHHmm 형식으로 변환
  const fileName = `cloudmount.json`;
  const localFilePath = path.join(process.cwd(), fileName);
  
  // JSON 파일 저장
  fs.writeFileSync(localFilePath, jsonData);
  console.log(`\n폴더 정보가 ${fileName} 파일에 저장되었습니다.`);
  console.log(`총 크기: ${formatFileSize(folderInfo.size)}`);
  console.log(`총 파일 수: ${folderInfo.fileCount}`);
  console.log(`하위 폴더 수: ${folderInfo.subFolders.length}`);
  if (folderInfo.latestFile) {
    console.log(`가장 최근 수정된 파일: ${folderInfo.latestFile.name}`);
    console.log(`최근 파일 크기: ${formatFileSize(folderInfo.latestFile.size)}`);
  }

  // SFTP 연결 및 파일 전송
  const conn = new Client();
  
  conn.on('ready', () => {
    console.log('\nSFTP 서버에 연결되었습니다.');
    conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
      if (err) {
        console.error('SFTP 연결 오류:', err);
        conn.end();
        return;
      }

      const remoteFilePath = path.join(config.sftp.remotePath, fileName).replace(/\\/g, '/');
      const readStream = fs.createReadStream(localFilePath);
      const writeStream = sftp.createWriteStream(remoteFilePath);

      // 스트림 에러 핸들링 추가
      readStream.on('error', (err: Error) => {
        console.error('읽기 스트림 오류:', err);
        writeStream.end();
        conn.end();
      });

      writeStream.on('error', (err: Error) => {
        console.error('쓰기 스트림 오류:', err);
        readStream.destroy();
        conn.end();
      });

      writeStream.on('close', () => {
        console.log(`\n파일이 성공적으로 전송되었습니다: ${remoteFilePath}`);
        
        // 약간의 지연 후 연결 종료
        setTimeout(() => {
          conn.end();
        }, 1000);
        
        // 로컬 파일 삭제
        fs.unlinkSync(localFilePath);
      });

      readStream.pipe(writeStream);
    });
  });

  // 연결 종료 이벤트 핸들링 추가
  conn.on('end', () => {
    console.log('SFTP 연결이 정상적으로 종료되었습니다.');
  });

  conn.on('error', (err: Error & { code?: string }) => {
    // ECONNRESET 에러는 파일 전송 완료 후 발생하면 무시
    if (err.code === 'ECONNRESET') {
      // console.log(err);
      console.log('연결이 종료되었습니다. (정상적인 종료 과정)');
      return;
    }
    console.error('연결 오류:', err);
  });

  conn.connect({
    host: config.sftp.host,
    port: config.sftp.port,
    username: config.sftp.username,
    password: config.sftp.password
  });
}

async function startTransfer() {
  try {
    const config = loadConfig();
    await transferFolderInfo(config);
  } catch (error) {
    console.error('프로그램 실행 중 오류 발생:', error);
  }
}

console.log('폴더 정보 수집 및 전송 프로그램을 시작합니다...');
startTransfer(); 