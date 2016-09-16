var Bus = require('../../index.js').Bus;
var stdin = process.openStdin();

console.log("Starting Sender");

var bus = new Bus({
    amqpSettings: {
        queue: {
            name: 'ServiceConnect.Samples.Sender',
            autoDelete: true
        },
        host: "amqp://guest:guest@localhost"
    },
    events: {
        connected: function(){

            console.log("Press any key to send message.  Enter 'exit' to stop.");

            var count = 0;

            stdin.addListener("data", function(d) {
                if (d.toString().trim() == "exit"){
                    bus.close();
                    process.exit()
                }
                bus.send('ServiceConnect.Samples.Consumer', "ConsumerCommand", { data: count });
                console.log("Sent command");
                count++;
            });

        }
    }
});




