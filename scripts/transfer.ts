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

type Question = {
  key: keyof SFTPConfig;
  question: string;
};

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

async function findAndTransferFiles(folderPath: string, config: SFTPConfig) {
  console.log(`\n${folderPath} 폴더에서 파일을 검색 중...`);

  const conn = new Client();
  const filesToTransfer: string[] = [];

  // 로컬 파일 검색
  function findFiles(dir: string) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        findFiles(fullPath);
      } else {
        filesToTransfer.push(fullPath);
        console.log(`발견된 파일: ${fullPath}`);
      }
    }
  }

  findFiles(folderPath);
  console.log(`\n총 ${filesToTransfer.length}개의 파일을 발견했습니다.`);

  // SFTP 연결 및 파일 전송
  conn.on('ready', () => {
    console.log('\nSFTP 서버에 연결되었습니다.');
    conn.sftp((err: Error | undefined, sftp: SFTPWrapper) => {
      if (err) {
        console.error('SFTP 연결 오류:', err);
        conn.end();
        return;
      }

      let transferredCount = 0;
      const totalFiles = filesToTransfer.length;

      async function transferNextFile() {
        if (transferredCount >= totalFiles) {
          console.log('\n모든 파일 전송이 완료되었습니다.');
          conn.end();
          return;
        }

        const filePath = filesToTransfer[transferredCount];
        const relativePath = path.relative(folderPath, filePath);
        const remoteFilePath = path.join(config.remotePath, relativePath).replace(/\\/g, '/');

        // 원격 디렉토리 생성
        const remoteDir = path.dirname(remoteFilePath);
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(remoteDir, (err) => {
            if (err) {
              // 디렉토리가 이미 존재하는 경우는 무시
              if ((err as any).code !== 4) {
                reject(err);
              } else {
                resolve();
              }
            } else {
              resolve();
            }
          });
        });

        // 파일 전송
        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(filePath);
          const writeStream = sftp.createWriteStream(remoteFilePath);

          writeStream.on('close', () => {
            transferredCount++;
            console.log(`[${transferredCount}/${totalFiles}] ${filePath} -> ${remoteFilePath}`);
            resolve();
          });

          writeStream.on('error', (err: Error) => {
            console.error(`파일 전송 오류 (${filePath}):`, err);
            reject(err);
          });

          readStream.pipe(writeStream);
        });

        transferNextFile();
      }

      transferNextFile();
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
  rl.question('\n전송할 폴더 경로를 입력하세요: ', async (folderPath) => {
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
    await findAndTransferFiles(folderPath, config);

    rl.question('\n다른 폴더를 전송하시겠습니까? (y/n): ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        startTransfer();
      } else {
        console.log('\n프로그램을 종료합니다.');
        rl.close();
      }
    });
  });
}

console.log('SFTP 파일 전송 프로그램을 시작합니다...');
startTransfer(); 