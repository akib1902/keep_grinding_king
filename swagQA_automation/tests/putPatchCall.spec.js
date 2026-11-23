import {test, expect} from '@playwright/test';


test('put example', async ({request}) => {

    const auth_Data = {
        username: 'admin', password: 'password123'
    }
    const response = await request.post('https://restful-booker.herokuapp.com/auth', {headers: {"Content-Type": "application/json"}, data: auth_Data});
    const jsonResponse = await response.json();
    const token = jsonResponse.token;
    console.log('Response status:'+ token);

    expect(response.status()).toBe(200);
    expect(token).toBeTruthy();




    const newBookingData = {
    "firstname" : "James",
    "lastname" : "Brown",
    "totalprice" : 111,
    "depositpaid" : true,
    "bookingdates" : {
        "checkin" : "2018-01-01",
        "checkout" : "2019-01-01"
    },
    "additionalneeds" : "Breakfast"
}






    const newbookingResponse = await request.post('https://restful-booker.herokuapp.com/booking', {headers: {"Content-Type": "application/json"}, data: newBookingData});
    const newBookingJsonResponse = await newbookingResponse.json();
    const bookingId = newBookingJsonResponse.bookingid;
    console.log(newBookingJsonResponse);
    console.log('New Booking ID: ' + bookingId);






    const putResponse = await request.put(`https://restful-booker.herokuapp.com/booking/${bookingId}`, {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cookie": `token=${token}`
        },
        data: {
            "firstname": "akib",
            "lastname": "ahmedd",
            "totalprice": 300,
            "depositpaid": false,
            "bookingdates": {
                "checkin": "2020-01-01",
                "checkout": "2021-01-01"
            },
            "additionalneeds": "dinner"
        }
    });

    const putResponseBody = await putResponse.json();
    console.log('Put Response Status:', putResponse.status());
    console.log('Put Response Body:', putResponseBody);






    
    
    
    const patchresponse = await request.patch(`https://restful-booker.herokuapp.com/booking/${bookingId}`, {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cookie": `token=${token}`
        }
    });
    const patchResponseBody = await patchresponse.json();
    console.log('Patch Response Body:', patchResponseBody);


    const deleteResponse = await request.delete(`https://restful-booker.herokuapp.com/booking/${bookingId}`, {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cookie": `token=${token}`
        }
    });
    console.log('Delete Response Status:', deleteResponse.status());
    console.log('status text:', deleteResponse.statusText());

});