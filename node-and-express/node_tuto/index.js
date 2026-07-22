// const path = require("path");
// const fs = require("fs");
// const { json } = require("stream/consumers");
// const filepath = path.join(__dirname, "package.json");
// //sync
// const data = fs. readFileSync(filepath, "utf-8");
// //async
// fs.readFile(filepath, "utf-8", (err, data) => {
//     if(err) throw err;
//     console.log(JSON.parse(data))
// })

// //server
// const http = require("http");
// const server = http.createServer((req, res) => {
//     if(req.url === "/" && req.method === "GET"){
//         res.writeHead(200, {"content-Type": "text/plain"});
//         res.end("welcome to the job tracker api");
//     }
// });
// server.listen(3000,()=>{
//     console.log("server running on http://localhost:3000/");
// });


//express
const express = require("express");
const app = express();

app.use(express.json());

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
})
app.get("/", (req, res) => {
    res.send("welcome to the job tracker apoi");
    console.log ("go to applications:id");
    console.log ("go to applications");
    console.log ("go to network-error");
});
app.get("/network-error", (req, res) => {//checking routes
    res.send("Error 404");
});
app.get("/applications:id", (req, res) => {//with id
    res.send(`fetching application with id ${req.params.id}`);
});
app.get("/applications", (req, res) => {//status
    const {status} = req.query;
    res.send(`filtering by status: ${status}`);
});
app.listen(3000, () => {console.log("http://localhost:3000/")});