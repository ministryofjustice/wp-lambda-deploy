# lambda-deploy
Experimenting with Lambda CodePipeline function

This AWS Lambda function deploys a docker image using cloud formation.

It takes 3 input assets:
* Cloud Formation template
* Application specific deployment params (like db credentials)
* The tag that was applied to the docker image

It also takes a stage as a user parameter (dev, staging, production)

# TODO:
* Add better fail case if required files are not found
* Create a registry tag on deploy to show what revision has been deployed to each enviroment (see https://docs.docker.com/registry/spec/api/)
* Wait for cf stack update to complete (may need lambda continuations)
* Send message to hipchat on deploy
* Send message to hipchat when manual approval needed
