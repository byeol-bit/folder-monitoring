import { Client, SFTPWrapper } from 'ssh2';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { stdin as input, stdout as output } from 'process';

const rl = readline.createInterface({
  input,
  output
});

interface SFTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

interface FolderInfo {
  path: string;
  size: number;
  fileCount: number;
  subFolders: FolderInfo[];
}

type Question = {
  key: keyof SFTPConfig;
  question: string;
};

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

async function getSFTPConfig(): Promise<SFTPConfig> {
  return new Promise((resolve) => {
    const config: SFTPConfig = {
      host: '',
      port: 22,
      username: '',
      password: '',
      remotePath: ''
    };

    const questions: Question[] = [
      { key: 'host', question: 'SFTP 서버 주소를 입력하세요: ' },
      { key: 'port', question: 'SFTP 포트를 입력하세요 (기본값: 22): ' },
      { key: 'username', question: '사용자 이름을 입력하세요: ' },
      { key: 'password', question: '비밀번호를 입력하세요: ' },
      { key: 'remotePath', question: '원격 서버의 저장 경로를 입력하세요: ' }
    ];

    let currentIndex = 0;

    function askQuestion() {
      if (currentIndex >= questions.length) {
        resolve(config);
        return;
      }

      const { key, question } = questions[currentIndex];
      rl.question(question, (answer) => {
        if (key === 'port') {
          config[key] = answer ? parseInt(answer) : 22;
        } else {
          config[key] = answer;
        }
        currentIndex++;
        askQuestion();
      });
    }

    askQuestion();
  });
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
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
  } catch (error) {
    console.log(`경고: ${folderPath} 폴더에 접근할 수 없습니다. 건너뜁니다.`);
  }

  return info;
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const parts = remotePath.split('/').filter(Boolean);
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    try {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(currentPath, (err) => {
          if (err) {
            // 디렉토리가 이미 존재하는 경우는 무시
            if ((err as any).code === 4) {
              resolve();
            } else {
              reject(err);
            }
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`원격 디렉토리 생성 오류 (${currentPath}):`, error);
      throw error;
    }
  }
}

async function transferFolderInfo(folderPath: string, config: SFTPConfig) {
  console.log(`\n${folderPath} 폴더 정보를 수집하고 있습니다...`);
  
  const folderInfo = await collectFolderInfo(folderPath);
  const jsonData = JSON.stringify(folderInfo, null, 2);
  
  // 현재 시간을 포함한 파일명 생성
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `folder-info-${timestamp}.json`;
  const localFilePath = path.join(process.cwd(), fileName);
  
  // JSON 파일 저장
  fs.writeFileSync(localFilePath, jsonData);
  console.log(`\n폴더 정보가 ${fileName} 파일에 저장되었습니다.`);
  console.log(`총 크기: ${formatSize(folderInfo.size)}`);
  console.log(`총 파일 수: ${folderInfo.fileCount}`);
  console.log(`하위 폴더 수: ${folderInfo.subFolders.length}`);

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

      const remoteFilePath = path.join(config.remotePath, fileName).replace(/\\/g, '/');

      // 파일 전송
      const readStream = fs.createReadStream(localFilePath);
      const writeStream = sftp.createWriteStream(remoteFilePath);

      writeStream.on('close', () => {
        console.log(`\n파일이 성공적으로 전송되었습니다: ${remoteFilePath}`);
        // 로컬 파일 삭제
        fs.unlinkSync(localFilePath);
        conn.end();
      });

      writeStream.on('error', (err: Error) => {
        console.error('파일 전송 오류:', err);
        conn.end();
      });

      readStream.pipe(writeStream);
    });
  });

  conn.on('error', (err: Error) => {
    console.error('연결 오류:', err);
  });

  conn.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password
  });
}

async function startTransfer() {
  rl.question('\n정보를 수집할 폴더 경로를 입력하세요: ', async (folderPath) => {
    if (!folderPath) {
      console.log('폴더 경로를 입력해주세요.');
      startTransfer();
      return;
    }

    if (!fs.existsSync(folderPath)) {
      console.log('입력한 폴더가 존재하지 않습니다.');
      startTransfer();
      return;
    }

    console.log('\nSFTP 서버 정보를 입력해주세요.');
    const config = await getSFTPConfig();
    await transferFolderInfo(folderPath, config);

    rl.question('\n다른 폴더의 정보를 수집하시겠습니까? (y/n): ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        startTransfer();
      } else {
        console.log('\n프로그램을 종료합니다.');
        rl.close();
      }
    });
  });
}

console.log('폴더 정보 수집 및 전송 프로그램을 시작합니다...');
startTransfer(); 