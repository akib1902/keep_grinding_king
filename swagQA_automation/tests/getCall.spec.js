import { test, expect } from '@playwright/test';

test('getCall', async ({ request }) => {
  const response = await request.get('https://jsonplaceholder.typicode.com/posts/1');

  const responseBody = await response.json();
  const responseStatus = response.status();
  const responseHeaders = response.headers();
  const responseStatusText = response.statusText();
  const responseHeadersArray = response.headersArray();

  console.log(responseStatusText);

  expect(responseStatus).toBe(200);
  expect(responseBody).toHaveProperty('id', 1);
  expect(responseStatusText).toBe('OK');
  expect(responseBody).toHaveProperty('userId', 1);
  expect(responseBody).toHaveProperty('title', 'sunt aut facere repellat provident occaecati excepturi optio reprehenderit');
  expect(responseBody.body).toContain('quia et suscipit\nsuscipit recusandae consequuntur expedita et cum\nreprehenderit molestiae ut ut quas totam\nnostrum rerum est autem sunt rem eveniet architecto');
  expect(responseHeaders).toHaveProperty('content-type', 'application/json; charset=utf-8');
});