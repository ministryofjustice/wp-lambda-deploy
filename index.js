const AWS = require('aws-sdk');
const unzip = require('unzip-stream');
const stream = require('stream');

exports.handler = function(event, context) {
    let codepipeline = new AWS.CodePipeline({apiVersion: '2015-07-09'});
    let s3 = new AWS.S3({apiVersion: '2006-03-01', signatureVersion: 'v4', correctClockSkew: true});
    let cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15', region: 'eu-west-2'});

    // Retrieve the Job ID from the Lambda action
    let jobId = event["CodePipeline.job"].id;
    let jobData = event["CodePipeline.job"].data;

    let userParams = JSON.parse(jobData.actionConfiguration.configuration.UserParameters);

    let cfParamsFilename = userParams.Env + '.json'
    let cfTemplatesFilename = 'hosting/stack-template.yaml'
    let buildTagFilename = 'BUILD_TAG.txt'

    // Always dump event, is very useful to debug
    console.log('Dumping the event: ', event);
    console.log('CodePipeline Job ID:', jobId);
    console.log('Going to deploy:', userParams);
    console.log('Expecting to find params file at:', cfParamsFilename);

    // Notify CodePipeline of successful job, and exit with success
    const exitSuccess = function(message, wait = false) {
        let params = {
            jobId: jobId,
            continuationToken: wait ? jobId : undefined, // we just need a string to validate
        };
        codepipeline.putJobSuccessResult(params, function(err, data) {
            if (err) {
                context.fail(err);
            } else {
                context.succeed(message);
            }
        });
    };

    // Notify CodePipeline of failed job, and exit with failure
    const exitFailure = function(message) {
        let params = {
            jobId: jobId,
            failureDetails: {
                message: message,
                type: 'JobFailed'
            }
        }
        codepipeline.putJobFailureResult(params, function(err, data) {
            if (err) {
                context.fail(err);
            } else {
                context.fail(message);
            }
        });
    };

    const readFile = function(stream, cb) {
        let chunks = [];
        stream.on('data', function(chunk) {
            chunks.push(chunk.toString());
        });
        stream.on('end', function() {
            cb(chunks.join(''));
        });
    };

    console.log('The jobData.continuationToken is set to: ', (!jobData.continuationToken ? 'nothing' :jobData.continuationToken));

    // If we have a continuationToken that means that we are in the middle of one update.
    // Let's check the CF Stack status and depending on that continue waiting, success or fail this job
    if (jobData.continuationToken) {
        console.log("continuation....");
        let stackName = userParams.AppName + '-' + userParams.Env;
        cloudformation.describeStacks({
            StackName: stackName
        }, function(err, data) {
            if (err) {
                console.log(err, err.stack);
                exitFailure(`Failed to check status of stack: ${err.message}`);
            } else {
                console.log(data);
                let stackStatus = data.Stacks[0].StackStatus;
                switch(stackStatus) {
                    case "CREATE_COMPLETE":
                    case "UPDATE_COMPLETE":
                    // case "DELETE_COMPLETE": // not used right now, fall into default / fail
                        exitSuccess("Stack Updated");
                        break;
                    case "CREATE_IN_PROGRESS":
                    case "DELETE_IN_PROGRESS": // ?
                    case "REVIEW_IN_PROGRESS": // ?
                    case "ROLLBACK_IN_PROGRESS":
                    case "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS":
                    case "UPDATE_IN_PROGRESS":
                    case "UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS":
                    case "UPDATE_ROLLBACK_IN_PROGRESS":
                        exitSuccess('Updating Stack, waiting...', true);
                        break;
                    case "ROLLBACK_COMPLETE":
                    case "CREATE_FAILED":
                    case "DELETE_FAILED":
                    case "ROLLBACK_FAILED":
                    case "UPDATE_ROLLBACK_COMPLETE":
                    case "UPDATE_ROLLBACK_FAILED":
                    default:
                        exitFailure(`Stack "${stackName}" failed to update. Check the CloudFormation stack to get more info. Status: ${stackStatus}`);
                }
            }
        });
        return;
    }

    const handlePromiseError = function(error, userMessage) {
        console.error(userMessage);
        console.error(error);
        exitFailure(userMessage);
    }

    let promises = [];

    console.log('Running jobData.....');

    jobData.inputArtifacts.forEach(function(artifact) {
        let artifactName = artifact.name

        let s3Params = {
            Bucket: artifact.location.s3Location.bucketName,
            Key: artifact.location.s3Location.objectKey
        }

        console.log('Outside the promise, artifactName is: ', artifactName);

        const myPromise = new Promise(function(fulfill, reject) {
            s3.getObject(s3Params)
            .createReadStream()
            .pipe(unzip.Parse())
            .on('entry', function (entry) {
                var fileName = entry.path;


                console.log('Inside jobData (on entry), fileName is: ', fileName);
                console.log('Inside jobData (on entry), cfParamsFilename is: ', cfParamsFilename);

                var returnFile = function() {
                    readFile(entry, function(fileContents) {
                        fulfill({name: fileName, contents: fileContents});
                    });
                };

                if (artifactName === 'CfTemplates' && fileName === cfTemplatesFilename) {
                    returnFile();
                } else if (artifactName === 'CfParams' && fileName === cfParamsFilename) {
                    returnFile();
                } else if (artifactName === 'DeployTag' && fileName === buildTagFilename) {
                    returnFile();
                } else {
                    entry.autodrain();
                }
            });
        });

        promises.push(myPromise);
    });

    console.log('Running jobData is now complete.');

    Promise.all(promises).then(function(values) {
        let stackParams = values.find((f) => { return f.name === cfParamsFilename; }).contents;
        let cloudTemplate = values.find((f) => { return f.name === cfTemplatesFilename; }).contents;
        let buildTag = values.find((f) => { return f.name === buildTagFilename; }).contents;

        stackParams = JSON.parse(stackParams);

        let dockerImage;
        stackParams.forEach((value, index) => {
            if (value.ParameterKey === 'DockerImage') {
                stackParams[index].ParameterValue =
                  stackParams[index].ParameterValue.replace('<DEPLOY_TAG>', buildTag);
                  dockerImage = stackParams[index].ParameterValue;
            }
        });

        let cloudFormationParams = {
            StackName: userParams.AppName + '-' + userParams.Env,
            TemplateBody: cloudTemplate,
            Parameters: stackParams,
            Capabilities: [ 'CAPABILITY_IAM' ]
        };

        console.log('Using build tag:', buildTag);
        console.log('Docker image:', dockerImage);

        const cloudCheckPromise = new Promise(function(fulfill, reject){
            let params = { StackName: cloudFormationParams.StackName };
            cloudformation.describeStacks(params, function(err, data){
                if (err) {
                    if (err.code === 'ValidationError'){
                        fulfill('createStack');
                    } else {
                        reject(err);
                    }
                } else {
                    fulfill('updateStack');
                }
            });
        });

        cloudCheckPromise.then(function(deployMethod) {
            const cloudFormationPromise = new Promise(function(fulfill, reject) {
                console.log('About to call ' + deployMethod + ' on CloudFormation stack');
                cloudformation[deployMethod](cloudFormationParams, function(err, data) {
                    if (err) {
                        console.log(err, err.stack);
                        reject(err);
                    } else {
                        console.log(data);
                        fulfill(data);
                    }
                });
            });

            cloudFormationPromise.then(function(result) {
                exitSuccess('Updating Stack....', true);
            }, function(err) {
                handlePromiseError(err, 'Failed to update CloudFormation stack');
            });

        }, function(err) {
            handlePromiseError(err, 'Failed to determine if stack exists.');
        });

    }).catch(function(err) {
        handlePromiseError(err, 'Unable to extract files from zipped input artifacts!');
    });
};
