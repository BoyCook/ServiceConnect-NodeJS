var Bus = require('../../index.js');
var stdin = process.openStdin();

console.log("Starting Consumer");

var bus = new Bus({
    amqpSettings: {
        queue: {
            name: 'ServiceConnect.Samples.Consumer'
        },
        host: "amqp://guest:guest@localhost"
    }
});

bus.init(function(){

    bus.addHandler("ConsumerCommand", function(message){
        console.log("Consumer 2: Received message");
        console.log(message);
    });

    console.log("Enter 'exit' to stop.");
    stdin.addListener("data", function(d) {
        if (d.toString().trim() == "exit"){
            bus.close();
        }
    });

});
