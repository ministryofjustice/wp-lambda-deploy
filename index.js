var AWS = require('aws-sdk');
var unzip = require('unzip');
var stream = require('stream');

exports.handler = function(event, context) {
    var codepipeline = new AWS.CodePipeline({apiVersion: '2015-07-09'});
    var s3 = new AWS.S3({apiVersion: '2006-03-01', signatureVersion: 'v4'});
    var cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15'});

    // Retrieve the Job ID from the Lambda action
    var jobId = event["CodePipeline.job"].id;

    console.log('event["CodePipeline.job"]', event["CodePipeline.job"]);

    // Notify CodePipline of successful job, and exit with success
    var exitSuccess = function(message) {
        var params = { jobId: jobId }
        codepipeline.putJobSuccessResult(params, function(err, data) {
            if (err) {
                context.fail(err);
            } else {
                context.succeed(message);
            }
        });
    };

    // Notify CodePipeline of failed job, and exit with failure
    var exitFailure = function(message) {
        var params = {
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

    var readFile = function(stream, cb) {
        var chunks = [];
        stream.on('data', function(chunk) {
            chunks.push(chunk.toString());
        });
        stream.on('end', function() {
            cb(chunks.join(''));
        });
    };

    var artifacts = event["CodePipeline.job"].data.inputArtifacts;

    var promises = [];

    artifacts.forEach(function(artifact) {
        // console.log(artifact);

        var artifactName = artifact.name

        // console.log(artifact.location.s3Location.bucketName);
        console.log('ABOUT TO LIST');

        var s3Params = {
            Bucket: artifact.location.s3Location.bucketName,
            Key: artifact.location.s3Location.objectKey
        }

        var mypromise = new Promise(function(fulfill, reject) {
            s3.getObject(s3Params).createReadStream()
            .pipe(unzip.Parse())
            .on('entry', function (entry) {
                var fileName = entry.path;
                var type = entry.type; // 'Directory' or 'File'
                var size = entry.size;

                console.log({
                    artifactName: artifactName,
                    fileName: fileName
                });

                var returnFile = function() {
                    readFile(entry, function(fileContents) {
                        fulfill({name: fileName, contents: fileContents});
                    });
                };

                if (artifactName == 'CfTemplate' && fileName == "wp-stack.yaml") {
                    returnFile();
                } else if (artifactName == 'CfParams' && fileName == "knowthething/dev.json") {
                    returnFile();
                } else if (artifactName == 'DeployTag' && fileName == "BUILD_TAG.txt") {
                    returnFile();
                } else {
                    entry.autodrain();
                }
            });
        });

        promises.push(mypromise);

        console.log('DONE LIST');

    });

    Promise.all(promises).then(function(values) {
        var stackParams = values.find((f) => { return f.name === 'knowthething/dev.json'; }).contents;
        stackParams = JSON.parse(stackParams);
        var buildTag = values.find((f) => { return f.name === 'BUILD_TAG.txt'; }).contents;

        stackParams.forEach((value, index) => {
            if (value.ParameterKey == 'DockerImage') {
                stackParams[index].ParameterValue = 'I changed it!';
            }
        });

        console.log('buildTag', buildTag);
        console.log('stackParams', stackParams);

        exitSuccess('All promises returned');
    }).catch(function(err) {
        console.log('Something went wrong with the promises');
        console.log(err);
        exitFailure('Something went wrong');
    });
};
