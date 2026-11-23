import {test, expect, request} from '@playwright/test';

test('check api health', async ({request}) => {

    test.setTimeout(0); 
    let maxDuration = 1000;
    while(true) {

        const start = Date.now();
        const response = await request.get('https://restful-booker.herokuapp.com/ping');
        const end = Date.now();
        const duration = end - start;
        console.log('Response status:', response.status());

        if(duration > maxDuration) {
            throw new Error(`Response time exceeded ${maxDuration}ms: ${duration} ms`);
        }
        else{
            console.log('Response time:', duration, 'ms');

        }

        maxDuration = 250;

        expect(response.status()).toBe(201);
    }
});