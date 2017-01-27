## What this does
Generate data for a device on Tago, using the content of a Google Spreadsheet. Is an automated way to simulate a real device.

## How to run the script on Tago
* Create a Google Spreadsheet following this template: [Training Spreadsheet](https://docs.google.com/spreadsheets/d/1MF5xih03tlFQzZD7fBbFS8miLiOK-d-5o_8PqT3oEH8/edit?usp=sharing).<br>
* Variable names on the spreadsheet can't contain **comma** or **spaces**. Values can't contain **comma**;<br>
* Make sure that your spreadsheet was share for Public visualization.
* Create a new Analysis, in the admin website.<br>
* Upload archive `scheduler.js.tago.js` to Tago analysis.<br>
* Click on **Show Variables** and **New**. Input "*url*" on name entry, and the URL from your Google Spreadsheet on "*value*' entry.<br>
* Create or get a token from the device that will receive the simulated data.<br>
* Click on **Show Variables** and **New**. Input "*device_token*" on name entry, and the token on "*value*' entry.<br>
* Click and configure the **Time Interval** to run your script. Every row in the spreadsheet will be written in the device in that interval.<br>
* Click on **Save**.<br>

## Check if it is Running
* On Analysis, in the admin website, inside your schedule analysis.<br>
* Click on **Show Console**.<br>
* Click on **Run Script**.<br>
* Check the Console if it have any errors or if it is successful.<br>

## Google Spreadsheet and private properties
Some variables will not be created as you input them in your spreadsheet. It is because this analysis will treat theses variables as properties.
Let take a look:
* **color**: Will become a propertie of all variables generated by the spreadsheet. You can visualize color em some widgets like maps and tables;
* **time**: Will become a propertie of all variables generated by the spreadsheet. It fix a time for the variable be added, it can be in the future or in the past. Make sure to use the format *"MM/DD/YYYY HH:mm"*;
* **email**: Send a e-mail to the address. Use with email_msg to personalize the message.
* **email_msg**: Body of the message to be sent. Use with email.
