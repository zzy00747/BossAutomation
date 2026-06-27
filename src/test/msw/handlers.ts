import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json', () => {
    return HttpResponse.json({ code: 0, message: 'OK', zpData: { jobList: [] } });
  }),
];

export const server = setupServer(...handlers);
