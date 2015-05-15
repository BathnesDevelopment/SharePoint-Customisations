<!-- Reference jQuery on the Google CDN -->
<script type="text/javascript" src="//ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js"></script>
<!-- Reference SPServices on cdnjs (Cloudflare) -->
<script type="text/javascript" src="//cdnjs.cloudflare.com/ajax/libs/jquery.SPServices/2014.02/jquery.SPServices-2014.02.min.js"></script>
<!--<script type="text/javascript" src="/_layouts/15/sp.js"></script>
<script type="text/javascript" src="/_layouts/15/sp.core.js"></script>
<script type="text/javascript" src="/_layouts/15/sp.runtime.js"></script>-->

<script type="text/javascript" src="/_layouts/15/sp.workflowservices.js"></script>
<script type="text/javascript" src="/_layouts/15/clientpeoplepicker.js"></script>
<script type="text/javascript" src="/_layouts/15/clientforms.js"></script>
<script type="text/javascript" src="/_layouts/15/clienttemplates.js"></script>
<script type="text/javascript" src="/_layouts/15/autofill.js"></script>

<script type="text/javascript">

var context = null;
var web = null;
var listId = null;
var itemGuid = null;
var workflowName = null;
var waitDialog = null;
// The input parameters object should match the parameters that are set within the workflow.
// For now we'll be manually building this up but there should be a way to dynamically create an input
// parameter form based on workflow defintions (*optimistic*!)
var inputParameters = {};
var input = -1;
var existingValues = {};
var wfFriendlyName = "";
var submission = "";
var items = "";
var selectedItemIds = null;
var workflowSuccessMessage = "";
var originalValues = "";
var multiContinueError = "";
var runOnce = false;

////////////////////////////////////////////////////////////////////////////////////
// Document ready
// On document ready we override a number of function in order
// to intercept events
////////////////////////////////////////////////////////////////////////////////////
$(function(){
    /////////
    // Overriding the UploadProgressFunc
    // Show a modal dialog showing what has been uploaded via drag and drop.
    // To do: Get rid of timeout and sort out on load!
    /////////
    setTimeout( function(){
        if(typeof UploadProgressFunc != 'undefined'){
            var origUploadFinishFunc = UploadFinishFunc;
            UploadFinishFunc = function(b,a) {
                typeof g_currentControl.postUploadFunc == "function" && a.status != UploadStatus.CANCELLED
                    && g_currentControl.postUploadFunc(a.files);
                g_currentControl.status = ControlStatus.UPLOADED;
                UpdateProgressBar(ProgressMessage.UPLOADED,a);

                var alertMessage = 'Files successfully uploaded: <br/>';
                for (var x = 0 ; x < a.files.length ; x++) {
                    if (x !== 0) alertMessage += ', <br/>';
                    alertMessage += a.files[x].fileName;
                }

                var options = SP.UI.$create_DialogOptions();
                var element = document.createElement('div');
                element.innerHTML = '<p>' + alertMessage + '</p><div id="buttonDiv"><input type="button" value="OK" onclick="waitDialog.close(1); return false;" />';
                options.title = "File upload";
                options.width = 400;
                options.height = 200;
                options.html = element;
                options.dialogReturnValueCallback = function (dialogResult) {
                    SP.UI.ModalDialog.RefreshPage(1);
                };
                waitDialog = SP.UI.ModalDialog.showModalDialog(options);

                RefreshResult(a);
                g_currentControl.status = ControlStatus.IDLE
            };
        }

        // Also try to edit the command handlers.
        console.log(g_commandUIHandlers);
        if (g_commandUIHandlers && g_commandUIHandlers.children);
        for (var handler in g_commandUIHandlers.children) {
            // "javascript:SP.ListOperation.Selection.getSelectedItems().length==1"
            if (g_commandUIHandlers.children[handler].attrs && g_commandUIHandlers.children[handler].attrs.EnabledScript && g_commandUIHandlers.children[handler].attrs.CommandAction
            && (g_commandUIHandlers.children[handler].attrs.CommandAction.indexOf('CarbonCopy') != -1
                || g_commandUIHandlers.children[handler].attrs.CommandAction.indexOf('Transfer') != -1
                || g_commandUIHandlers.children[handler].attrs.CommandAction.indexOf('Email') != -1
                || g_commandUIHandlers.children[handler].attrs.CommandAction.indexOf('ReIndex') != -1
                || g_commandUIHandlers.children[handler].attrs.CommandAction.indexOf('Print') != -1)) {
                g_commandUIHandlers.children[handler].attrs.EnabledScript = g_commandUIHandlers.children[handler].attrs.EnabledScript.replace('length==1','length > 0');
            }
        }
    }, 1000);


    //////////////////////////////////////////////////
    // Comment this.
    //////////////////////////////////////////////////
    ExecuteOrDelayUntilScriptLoaded(function() {
        if ((window.location.href.search("rbdoc/Revenues") !== -1) ||
            (window.location.href.search("rbdoc/Benefits") !== -1) ||
            (window.location.href.search("rbdoc/NNDR") !== -1)) {
            g_uploadType = DragDropMode.NOTSUPPORTED;
            SPDragDropManager.DragDropMode = DragDropMode.NOTSUPPORTED;
            document.styleSheets[0].insertRule("td.ms-list-addnew {display:none !important;}",1);
        }
    }, "DragDrop.js");
});

//////////////////////////////////////////////////
// TRIGGER MULTIPLE SELECT WORKFLOWS
// getSelectedItems()
// Gets the currently selected items from the list for use in multi-item workflow.
//////////////////////////////////////////////////
function getSelectedItems()
{
    var dfd = $.Deferred(function () {
        var context = SP.ClientContext.get_current();
        listId = SP.ListOperation.Selection.getSelectedList(); //get selected list Id
        selectedItemIds = SP.ListOperation.Selection.getSelectedItems(context); //get selected objects

        var list = context.get_web().get_lists().getById(listId);
        var listItems = [];
        for (var idx in selectedItemIds)
        {
            var item = list.getItemById(parseInt(selectedItemIds[idx].id));
            //var file = item.get_file();
            context.load(item);
            listItems.push(item);
        }

        context.executeQueryAsync(
          function() {
              dfd.resolve(listItems);
          },
          function (sender, args) {
              dfd.reject(args.get_message());
          }
        );
    });
    return dfd.promise();
}

//////////////////////////////////////////////////
// TRIGGER MULTIPLE SELECT WORKFLOWS
// SubmitForm()
// Runs when an OK button is pressed on the form dialog for workflow.
// Loops through form items and builds them into the input parameters object.
//////////////////////////////////////////////////
function submitForm() {
    // The form is about to be submitted - loop through items and build up the input parameters object
    $.each($('#frmCustomWorkflow input'), function(){
        input = parseInt($(this).val());
        if (this.name !== "" && this.name.indexOf('peoplePicker') == -1){
            inputParameters[this.name] = input;
            submission += '<br />Field: <strong>' + this.name + '</strong> Value: <strong>' + input + '</strong><br/>';
        }

    });

    // For email we loop through the people picker people.
    if (inputParameters.Email === "") {
        inputParameters.Email = getPeoplePickerEmails();
    }

    // Trigger the current dialog to close with the success outcome
    waitDialog.close(1);
}

/////////////////////////////////////////////////////////////////
// TRIGGER MULTIPLE SELECT WORKFLOWS
// TEST: AlertSelectedItems()
// Used for testing custom actions. Alerts selected item IDs
////////////////////////////////////////////////////////////////
function AlertSelectedItems() {
    getSelectedItems().then(function(selectedItems){
        for (i = 0; i < selectedItems.length; i++) {
            alert(selectedItems[i].id);
        }
    });
}

//////////////////////////////////////////////////////////////////
// TRIGGER MULTIPLE SELECT WORKFLOWS
// function confirmDialog()
// Takes in a URL and shows it as a dialog, provides a confirmation message on 
// close.
//////////////////////////////////////////////////////////////////
function confirmDialog(url) {

    var confirmOptions = SP.UI.$create_DialogOptions();
    //confirmElement.innerHTML = '<p>Really apply this workflow?</p><p>' + items + '</p><h2>Submitted fields</h2><p>' + submission + '</p><div id="buttonDiv"><input type="button" value="Yes" onclick="waitDialog.close(1); return false;" /><input type="button" style="width:75px;" value="Cancel" onclick="waitDialog.close(0); return false;"/></div></div>';
    //confirmOptions.title = 'Confirm change';
    confirmOptions.width = 400;
    confirmOptions.height = 300;
    confirmOptions.url = url;
    confirmOptions.dialogReturnValueCallback = function (dialogResult) {
        if (dialogResult == 1) {
            return false;
        }
    };
    waitDialog = SP.UI.ModalDialog.showModalDialog(confirmOptions);
}

////////////////////////////////////////////////////////////////
// Function: VerifyReference
// Verifies that a reference number meets the requiremnts
// Inputs:  reference = the reference number (as a number)
//          type = the type of reference, as a string. See code for details
////////////////////////////////////////////////////////////////
function VerifyReference(reference, type) {
    var isInt = function (n) {
        return n % 1 === 0;
    };
    if (typeof reference !== "number" || !isInt(reference)){
        console.warn(reference, "is not an integer");
        return false;
    }
    switch (type) {
        case "revs":
            // 700XXXXX or XXXXXX
            return (69999999 < reference && reference < 70100000 ||
                   999999 < reference && reference < 10000000);
        case "claim":
            //1-7 digits
            return 0 < reference && reference < 10000000;
        case "nndr":
            // 3XXXXXX
            return 2999999 < reference && reference < 4000000;
        case "bid":
            // 777XXXX
            return 7769999 < reference && reference < 778000000;
        default: return false;
    }
}

////////////////////////////////////////////////////////////////
// Function: VerifyReference
// Verifies that a reference number meets the requiremnts
// Inputs:  reference = the reference number (as a number)
//          type = the type of reference, as a string. See code for details
////////////////////////////////////////////////////////////////
function getReferenceError(type) {
    return {
        "revs":"Must either be 8 digits long and start with 700 or 6 digits long",
        "claim":"Must be 1-7 digits long",
        "nndr":"Must be 8 digits long and start with 3 or 4",
        "bid":"Must be 7 digits long and begin with 777"
    }[type];
}

////////////////////////////////////////////////////////////////
// Function: ApplyMultiItemWorkflow
// Triggered by custom actions on lists.
// Inputs:  wfname = Actually a GUID that uses underscores
//          wfType = The RBDoc type of Workflow.  Will determine the dialog boxes shown.
////////////////////////////////////////////////////////////////
function ApplyMultiItemWorkflow(wfName, wfType) {
    var transferType = null;
    workflowName = wfName.split('_').join('-');
    context = new SP.ClientContext.get_current();
    web = context.get_web();
    listId = _spPageContextInfo.pageListId.replace('}','').replace('{','');
    var list = web.get_lists().getById(listId);

    getSelectedItems().then(function(selectedItems){

        // Using the DialogOptions class.
        var options = SP.UI.$create_DialogOptions();
        var element = document.createElement('div');
        var customForm = "";

        //for (i = 0 ; i < selectedItems.length ; i++) {
        //    items += selectedItems[i].get_item("FileLeafRef") + '<br/>';
        //}
        var rowItem;
        for (i = 0 ; i < selectedItemIds.length ; i++) {
            for (rowItem in WPQ2ListData.Row) {
                if (WPQ2ListData.Row[rowItem].ID == selectedItemIds[i].id) {
                    items += WPQ2ListData.Row[rowItem].FileLeafRef + '<br/>';
                    if (WPQ2ListData.Row[rowItem].CheckoutUser !== "") {
                        multiContinueError += "One or more of the selected items are checked out." +
                        "\n please ask the user who has checked this document out to check it in before continuing.";
                    }
                }
            }
        }

        var originalValuesDescription = "";
        // Depending on the workflow type we do different things.
        switch (wfType) {
            case 'Transfer':
                // For transfer we need to show
                inputParameters.Reference = "";
                if (window.location.href.search("rbdoc/Revenues") !== -1) {
                    transferType = "revs";
                } else if (window.location.href.search("rbdoc/Benefits") !== -1) {
                    transferType = "claim";
                } else if (window.location.href.search("rbdoc/NNDR") !== -1) {
                    transferType = "nndr";
                }

                for (l = 0 ; l < selectedItemIds.length ; l++) {
                    for (rowItem in WPQ2ListData.Row) {
                        if (WPQ2ListData.Row[rowItem].ID == selectedItemIds[l].id){
                            if (!existingValues.Reference) {
                                existingValues.Reference = WPQ2ListData.Row[rowItem].Reference;
                            }
                            else
                            {
                                if (existingValues.Reference != WPQ2ListData.Row[rowItem].Reference){
                                    multiContinueError += "You cannot bulk transfer items with different reference numbers.";
                                }
                            }
                        }
                    }
                }

                submission = "Enter the new account reference.";
                workflowSuccessMessage = "The document(s) will be transferred to the new account reference.";
                wfFriendlyName = "Transfer documents";
                break;
            case 'Email':
                // Email parameters: email address

                // For email we build up the set of links straight away (not a user input).
                var links = '';
                for (var k = 0; k < selectedItems.length; k++) {
                    links = links + '<a href="' + _spPageContextInfo.webAbsoluteUrl + selectedItems[k].get_item('FileRef') + '">' + selectedItems[k].get_item('FileRef') + '</a><br/>';
                }
                inputParameters.Links = links;
                inputParameters.Email = "";

                // For email we only run once and include all links in the email.
                runOnce = true;
                wfFriendlyName = "Email document links";
                originalValuesDescription = "Not applicable for email document links";

                workflowSuccessMessage = "The document(s) link will be sent as an email.";
                break;
            case 'ReIndex':
                // Re-index parameters: Account number and Functional Area
                inputParameters.Reference = "";

                for (l = 0 ; l < selectedItemIds.length ; l++) {
                    for (rowItem in WPQ2ListData.Row) {
                        if (WPQ2ListData.Row[rowItem].ID == selectedItemIds[l].id){
                            if (!existingValues.Reference) {
                                existingValues.Reference = WPQ2ListData.Row[rowItem].Reference;
                            }
                            else
                            {
                                if (existingValues.Reference != WPQ2ListData.Row[rowItem].Reference){
                                    multiContinueError = "Attempting multi-item workflow on records with different values.";
                                }
                            }
                        }
                    }
                }

                submission = "Enter the new account reference.";
                wfFriendlyName = "Re-index";
                workflowSuccessMessage = "The document will be moved to the drop off library.";
                break;
            case 'AddBatchPrint':
                // Batch print parameters: none
                wfFriendlyName = "Add to batch print queue";
                originalValuesDescription = "Not applicable for batch printing";
                submission = "Document(s) will be added to the print queue.";
                workflowSuccessMessage = "The document(s) will be added to the batch queue print.";
                break;
            case 'WithdrawBatchPrint':
                // Batch print parameters: none
                wfFriendlyName = "Withdraw from batch print queue";
                originalValuesDescription = "Not applicable for batch printing";
                submission = "Document(s) will be removed from the print queue (if existing).";
                workflowSuccessMessage = "The document(s) will be removed from the batch print queue.";
                break;
            case 'CarbonCopy':
                // Carbon copy just copies into the drop off library and strips out metadata.
                // Carbon copy parameters: Account number

                inputParameters.Reference = "";
                for (l = 0 ; l < selectedItemIds.length ; l++) {
                    for (rowItem in WPQ2ListData.Row) {

                        if (WPQ2ListData.Row[rowItem].ID == selectedItemIds[l].id){
                            if (!existingValues.Reference) {
                                existingValues.Reference = WPQ2ListData.Row[rowItem].Reference;
                            }
                            else
                            {
                                if (existingValues.Reference != WPQ2ListData.Row[rowItem].Reference) {
                                    multiContinueError = "Attempting multi-item workflow on records with different values.";
                                }
                            }
                        }
                    }
                }

                wfFriendlyName = "Carbon copy";
                submission = "Carbon copy will create a fresh copy of the document against a different account reference.";
                //originalValuesDescription = "Not applicable for Carbon copy.";
                workflowSuccessMessage = "The document(s) will be copied and added to the new account reference.";
                break;
            case 'Index':
                wfFriendlyName = "Index";
                submission = "";
                workflowSuccessMessage = "The document will be moved to the drop off library and indexed by the content organizer.";
                break;
            default:
                // do nothing
        }

        // Now we need to build up the input form
        for (var key in inputParameters) {
            if (key != 'Links' && key != 'Email') {
                customForm += '<p>' + key + ' <input type="text" required id="txtWfEmail" name="' + key + '" id="' + key + '"></p>';
            }
            if (key == 'Email') {
                customForm += '<p><div id="peoplePickerDiv"></div></p>';
            }
        }

        // Build up the original values
        for (var key in existingValues) {
            originalValuesDescription += 'Field: <strong>' + key + '</strong> Value: <strong>' + existingValues[key] + '</strong><br/>';
        }
        // If there is a validation error, show the message.
        if (multiContinueError && multiContinueError !== "") {
            //Using the DialogOptions class.
            var errorOptions = SP.UI.$create_DialogOptions();
            var errorElement = document.createElement('div');
            errorElement.innerHTML = '<p>' + multiContinueError + '</p><div id="buttonDiv"><input type="button" value="OK" onclick="waitDialog.close(1); return false;" />';
            errorOptions.title = "Error with workflow";
            errorOptions.width = 400;
            errorOptions.height = 400;
            errorOptions.html = errorElement;
            errorOptions.dialogReturnValueCallback = function () {
                // Reset the input parameters object
                ResetStuff();
            };
            waitDialog = SP.UI.ModalDialog.showModalDialog(errorOptions);
        }
        else
        {
            element.innerHTML = '<p>You are about to apply ' + wfType + ' workflow on the following items: </p><p><strong>' + items + '</strong></p><h2>Original value(s)</h2><p>' + originalValuesDescription + '</p><h2>Changes to apply</h2><p>' + submission + '</p><div id="frmCustomWorkflow">' + customForm + '</div><br/></br/><div id="buttonDiv"><input type="button" value="Yes" onclick="submitForm(); return false;" /><input type="button" value="Cancel" onclick="waitDialog.close(0); return false;"/></div></div>';
            options.title = wfFriendlyName;
            options.width = 400;
            options.height = 400;
            options.html = element;
            options.dialogReturnValueCallback = function (dialogResult){
                var confirmOptions = SP.UI.$create_DialogOptions();
                var confirmElement = document.createElement('div');
                if (dialogResult == 1) {
                    if (transferType  && !VerifyReference(input,transferType)) {
                        confirmElement.innerHTML =   '<h2>Submitted fields</h2><p>' + submission + '</p><br><p>Failed validation. ' + getReferenceError(transferType) + '<br/>Please retry with a valid reference number in order to transfer.<div id="buttonDiv"><input type="button" value="Ok" onclick="waitDialog.close(0); return false;" /></div></div>';
                        confirmOptions.title = 'Error';
                        confirmOptions.width = 400;
                        confirmOptions.height = 400;
                        confirmOptions.html = confirmElement;
                    } else {
                        // User has submitted the workflow dialog - show confirmation message to make sure they're happy
                        confirmElement.innerHTML = '<p>Really apply this workflow?</p><p><strong>' + items + '</strong></p><h2>Original value(s)</h2><p>' + originalValuesDescription + '</p><h2>Submitted fields</h2><p>' + submission + '</p><div id="buttonDiv"><input type="button" value="Yes" onclick="waitDialog.close(1); return false;" /><input type="button" style="width:75px;" value="Cancel" onclick="waitDialog.close(0); return false;"/></div></div>';
                        confirmOptions.title = 'Confirm change';
                        confirmOptions.width = 400;
                        confirmOptions.height = 400;
                        confirmOptions.html = confirmElement;
                    }
                    confirmOptions.dialogReturnValueCallback = function (dialogResult){
                        if (dialogResult == 1) {
                            // user has submitted confimation - lift off!
                            var lastItem = false;
                            //for (var z = 0; z < selectedItems.length; z++) {
                            //    if (z == selectedItems.length - 1) lastItem = true;
                            //    startWorkflow(selectedItems[z].get_item('ID'), workflowName, lastItem);
                            //}
                            for (var z = 0; z < selectedItemIds.length; z++) {
                                //for (var rowItem in WPQ2ListData.Row) {
                                    //if ((WPQ2ListData.Row[rowItem].ID == selectedItemIds[z].id) && !lastItem){
                                    if (!lastItem){
                                        if ((z == selectedItemIds.length - 1) || runOnce) lastItem = true;
                                        startWorkflow(selectedItems[z].get_item('ID'), workflowName, lastItem);
                                    }
                                //}
                            }
                        } else {ResetStuff();}
                    };
                    waitDialog = SP.UI.ModalDialog.showModalDialog(confirmOptions);

            } else { ResetStuff(); }
        };
            waitDialog = SP.UI.ModalDialog.showModalDialog(options);
            initializePeoplePicker('peoplePickerDiv');
        }
    });
}

///////////////////////////////////////////////////////////////////////////////////////////
// function setWorkflowTypeInputParameters
//
///////////////////////////////////////////////////////////////////////////////////////////
function setWorkflowTypeInputParameters(wfType) {

}

//////////////////////////////////////////////////////////////////////////////////
// resetStuff()
// Sets global variables back to empty for the next dialog/process
//////////////////////////////////////////////////////////////////////////////////
function ResetStuff() {
    // Reset stuff
    inputParameters = {};
    existingValues = {};
    items = "";
    submission = "";
    selectedItemIds = null;
    workflowSuccessMessage = "";
    customForm = "";
    multiContinueError = "";
    runOnce = false;
    workflowName = null;
    waitDialog = null;
    wfFriendlyName = "";
    originalValues = "";
    input = -1;
}

//////////////////////////////////////////////////////////////////////////////////
// StartWorkflow
// itemID: The ID of the item.  Found by using GetSelectedItems.
// subID: The subscription ID.  is found in List Workflow settings and passed in by custom action.
// lastItem: When calling in a loop this passes boolean to display confirmation dialog that all is done.
// Starts workflow (while in a loop) taking 
//////////////////////////////////////////////////////////////////////////////////
function startWorkflow(itemID, subID, lastItem) {

    var context = SP.ClientContext.get_current();
    var web = context.get_web();

    var wfServiceManager = SP.WorkflowServices.WorkflowServicesManager.newObject(context, web);
    var subscription = wfServiceManager.getWorkflowSubscriptionService().getSubscription(subID);

    context.load(subscription);

    context.executeQueryAsync(
        function(sender, args){
            console.log("Subscription load success. Attempting to start workflow.");
            wfServiceManager.getWorkflowInstanceService().startWorkflowOnListItem(subscription, itemID, inputParameters);

            context.executeQueryAsync(
                function(sender, args) {

                    console.log("Successfully starting workflow.");

                    if (lastItem) {
                        //Using the DialogOptions class.
                        var options = SP.UI.$create_DialogOptions();
                        var element = document.createElement('div');
                        element.innerHTML = '<p>Workflow has been triggered on the following items: </p><p><strong>' + items + '</strong></p><p>' + workflowSuccessMessage + '</p><div id="buttonDiv"><input type="button" value="OK" onclick="waitDialog.close(1); return false;" />';
                        options.title = "Workflow triggered";
                        options.width = 400;
                        options.height = 400;
                        options.html = element;
                        options.dialogReturnValueCallback = function (dialogResult) {
                            var redirect = "";
                            if (wfFriendlyName === "Re-index") {
                                redirect = "http://rbdoc/DropOffLibrary";
                            }
                            // Reset the input parameters object
                            ResetStuff();
                            if (redirect !== "") {
                                setTimeout(function(){
                                    window.location.replace(redirect);
                                }, 3000);
                            }
                            else {
                                SP.UI.ModalDialog.RefreshPage(1);
                            }
                        };
                        waitDialog = SP.UI.ModalDialog.showModalDialog(options);
                    }
                },
                function(sender, args) {
                    console.log("Failed to start workflow.");
                    console.log("Error: " + args.get_message() + "\n" + args.get_stackTrace());
                    ResetStuff();
                }
            );
        },
        function(sender,args){
            console.log("Failed to load subscription.");
            console.log("Error: " + args.get_message() + "\n" + args.get_stackTrace());
            ResetStuff();
        }
    );
}

////////////////////////////////////////////////////////////////
// Function: initializePeoplePicker
// Render and initialize the client-side People Picker.
////////////////////////////////////////////////////////////////
function initializePeoplePicker(peoplePickerElementId) {

    // Create a schema to store picker properties, and set the properties.
    var schema = {};
    schema.PrincipalAccountType = 'User,DL,SecGroup,SPGroup';
    schema.SearchPrincipalSource = 15;
    schema.ResolvePrincipalSource = 15;
    schema.AllowMultipleValues = true;
    schema.MaximumEntitySuggestions = 50;
    schema.Width = '280px';

    // Render and initialize the picker.
    // Pass the ID of the DOM element that contains the picker, an array of initial
    // PickerEntity objects to set the picker value, and a schema that defines
    // picker properties.
    this.SPClientPeoplePicker_InitStandaloneControlWrapper(peoplePickerElementId, null, schema);
}

////////////////////////////////////////////////////////////////
// Function: getUserInfo
// Query the picker for user information.
////////////////////////////////////////////////////////////////
function getUserInfo() {
    // Get the people picker object from the page.
    var peoplePicker = this.SPClientPeoplePicker.SPClientPeoplePickerDict.peoplePickerDiv_TopSpan;

    // Get information about all users.
    var users = peoplePicker.GetAllUserInfo();
    var userInfo = '';
    for (var i = 0; i < users.length; i++) {
        var user = users[i];
        for (var userProperty in user) {
            userInfo += userProperty + ':  ' + user[userProperty] + '<br>';
        }
    }
    $('#resolvedUsers').html(userInfo);

    // Get user keys.
    var keys = peoplePicker.GetAllUserKeys();
    $('#userKeys').html(keys);

    // Get the first user's ID by using the login name.
    getUserId(users[0].Key);
}

////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
function getPeoplePickerEmails() {
    // Get the people picker object from the page.
    var peoplePicker = this.SPClientPeoplePicker.SPClientPeoplePickerDict.peoplePickerDiv_TopSpan;
    var emails = "";

    // Get information about all users.
    var users = peoplePicker.GetAllUserInfo();
    var userInfo = '';
    for (var i = 0; i < users.length; i++) {
        var user = users[i];
        for (var userProperty in user) {
            userInfo += userProperty + ':  ' + user[userProperty] + '<br>';
        }
    }

    // Get user keys.
    var keys = peoplePicker.GetAllUserKeys();

    // Get the first user's ID by using the login name.
    emails = keys;
    return emails;
}

////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
function getUserId(loginName) {
    var context = new SP.ClientContext.get_current();
    this.user = context.get_web().ensureUser(loginName);
    context.load(this.user);
    context.executeQueryAsync(
         Function.createDelegate(null, ensureUserSuccess),
         Function.createDelegate(null, onFail)
    );
}

////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
function ensureUserSuccess() {
    $('#userId').html(this.user.get_id());
}

////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
function onFail(sender, args) {
    alert('Query failed. Error: ' + args.get_message());
}
</script>