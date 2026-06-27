import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fixtureJobs } from '../fixtures/jobs.js';
import { fixtureJobDetail } from '../fixtures/job-detail.js';
import type { NormalizedJob } from '../../types.js';

export const handlers = [
  http.get(
    'https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json',
    ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page') ?? 1);
      return HttpResponse.json({
        code: 0,
        message: 'OK',
        zpData: {
          jobList: fixtureJobs.map((job: NormalizedJob) => ({ ...job, page })),
          hasMore: page < 3,
          cursor: page < 3 ? `cursor-${page}` : undefined,
        },
      });
    },
  ),

  http.get(
    'https://www.zhipin.com/wapi/zpgeek/job/detail.json',
    ({ request }) => {
      const url = new URL(request.url);
      const encryptJobId = url.searchParams.get('encryptJobId') ?? fixtureJobDetail.encryptJobId;
      return HttpResponse.json({
        code: 0,
        message: 'OK',
        zpData: { ...fixtureJobDetail, encryptJobId },
      });
    },
  ),

  http.get(
    'https://www.zhipin.com/wapi/zpgeek/friend/add.json',
    () => {
      return HttpResponse.json({
        code: 0,
        message: 'OK',
        zpData: { success: true },
      });
    },
  ),
];

export const server = setupServer(...handlers);
