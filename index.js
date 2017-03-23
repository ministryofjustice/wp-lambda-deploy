var AWS = require('aws-sdk');
var unzip = require('unzip');
var stream = require('stream');

exports.handler = function(event, context) {
    
    var codepipeline = new AWS.CodePipeline({apiVersion: '2015-07-09'});
    var s3 = new AWS.S3({apiVersion: '2006-03-01'});
    var cloudformation = new AWS.CloudFormation({apiVersion: '2010-05-15'});

    // Retrieve the Job ID from the Lambda action
    var jobId = event["CodePipeline.job"].id;

    console.log(event["CodePipeline.job"]);

    var artifacts = event["CodePipeline.job"].data.inputArtifacts;

    artifacts.forEach(function(artifact) {
        console.log(artifact);

        var artifactName = artifact.name

        console.log(artifact.location.s3Location.bucketName);
        console.log('ABOUT TO LIST');

        s3.listObjects({Bucket: artifact.location.s3Location.bucketName}).promise().then(function(data) {
            console.log('It worked');
            console.log(data);
        }).catch(function(err) {
            console.log('It didnt work');
            console.log(err);
        });

        console.log('DONE LIST');

        // var s3Params = {
        //     Bucket: artifact.location.s3Location.bucketName,
        //     Key: artifact.location.s3Location.objectKey
        // }

        // s3.getObject(s3Params).createReadStream()
        // .pipe(unzip.Parse())
        // .on('entry', function (entry) {
        //     var fileName = entry.path;
        //     var type = entry.type; // 'Directory' or 'File'
        //     var size = entry.size;

        //     console.log(artifactName);
        //     console.log(fileName);

        //     if (artifactName == 'CfTemplate' && fileName === "this IS the file I'm looking for") {

        //     } else if (artifactName == 'CfParams' && fileName === "this IS the file I'm looking for") {

        //     } else if (artifactName == 'DeployTag' && fileName === "DEPLOY_TAG.txt") {
        //         // entry.pipe(fs.createWriteStream('output/path')); STASH IN VAR
        //     } else {
        //         entry.autodrain();
        //     }
        // });
    });

    
    // Notify AWS CodePipeline of a successful job
    var putJobSuccess = function(message) {
        var params = {
            jobId: jobId
        };
        codepipeline.putJobSuccessResult(params, function(err, data) {
            if(err) {
                context.fail(err);
            } else {
                context.succeed(message);
            }
        });
    };
    
    putJobSuccess("New version deployed.");
};
