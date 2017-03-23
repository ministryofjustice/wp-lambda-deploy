#!/bin/bash

FUNCTION="deployWpWeekly"
FILE="lambda.zip"
TEST_FILE="test.json"

echo "Creating ZIP archive"
rm -f $FILE
zip -r $FILE index.js package.json node_modules

echo "Uploading to Lambda"
aws lambda update-function-code --function-name $FUNCTION --zip-file fileb://$PWD/$FILE --region eu-west-1

echo "Invoking function on Lambda"
aws lambda invoke --function-name $FUNCTION --payload file://$PWD/$TEST_FILE --region eu-west-1 /dev/stdout
