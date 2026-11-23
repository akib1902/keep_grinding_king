import {test, expect} from '@playwright/test';


// Test to make a POST call with token and bookID
test('post call example with token and bookID', async ({request}) => {
    const authData = {
        username: 'testuser',
        password: 'testpassword'
    };

    const response = await request.post('https://restful-booker.herokuapp.com/auth', {header:{'Content-Type': 'application/json'} ,data: authData});

    console.log('Response status:', response.status());
    const responseData = await response.json();
    expect(responseData.token).not.toBeNull();
});



// Test to console log the JSON response and token
test('console json and token', async ({request}) => {
    const bookId = {
    "firstname" : "Jim",
    "lastname" : "Brown",
    "totalprice" : 111,
    "depositpaid" : true,
    "bookingdates" : {
        "checkin" : "2018-01-01",
        "checkout" : "2019-01-01"
    },
    "additionalneeds" : "dinner"
};

    const response = await request.post('https://restful-booker.herokuapp.com/booking', {header:{'Content-Type': 'application/json'} ,data: bookId});

    console.log(response.status());
    const responseData = await response.json();
    console.log(responseData);
});



