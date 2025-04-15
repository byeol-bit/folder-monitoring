import { NextResponse } from 'next/server';
import { getFolderInfo, formatSize } from '@/app/utils/folderUtils';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folderPath = searchParams.get('path');

  if (!folderPath) {
    return NextResponse.json(
      { error: '폴더 경로가 필요합니다.' },
      { status: 400 }
    );
  }

  try {
    const folderInfo = await getFolderInfo(folderPath);
    return NextResponse.json({
      ...folderInfo,
      formattedSize: formatSize(folderInfo.size)
    });
  } catch (error) {
    return NextResponse.json(
      { error: '폴더 정보를 가져오는 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
} 