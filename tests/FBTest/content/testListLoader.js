/* See license.txt for terms of usage */

FBTestApp.ns( /** @scope _testListLoader_ */ function() { with (FBL) {

// ************************************************************************************************
// Test Logger Implementation

var Cc = Components.classes;
var Ci = Components.interfaces;

// ************************************************************************************************

/** @namespace */
FBTestApp.TestListLoader =
{
    loadTestList: function(browser, testListPath, callback)
    {
        var watcher = new BrowserLoadWatcher(browser, testListPath, function(doc)
        {
            var groups = TestListLoader.processTestList(doc);

            if (FBTrace.DBG_FBTEST)
                FBTrace.sysout("fbtest.loadTestList; LOADED " + testListPath, groups);

            callback(groups);
        });
    },

    loadAllRegisteredTests: function(browser, callback)
    {
        var testLists = this.getRegisteredTestLists();
        if (!testLists.length)
        {
            if (FBTrace.DBG_FBTEST)
                FBTrace.sysout("fbtest.loadAllRegisteredTests; NO registered tests lists");
            return;
        }

        this.loadNextTest(testLists, [], function(groups)
        {
            if (FBTrace.DBG_FBTEST)
                FBTrace.sysout("fbtest.loadAllRegisteredTests; LOADED", groups);

            var watcher = new BrowserLoadWatcher(browser,
                "chrome://fbtest/content/testListFrame.html", function(doc)
            {
                TestListLoader.addStyleSheets(doc);
                callback(groups);
            });
        });
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

    loadNextTest: function(testLists, groups, callback)
    {
        if (!testLists.length)
        {
            if (FBTrace.DBG_FBTEST)
                FBTrace.sysout("fbtest.loadNextTest; Last test list loaded.", groups);
            callback(groups);
            return;
        }

        var testList = testLists.shift();
        if (!testList.testListURL)
        {
            if (FBTrace.DBG_FBTEST)
                FBTrace.sysout("fbtest.loadAllRegisteredTests; ERROR test URL is null", testList);

            // Continue with the next list.
            TestListLoader.loadNextTest(testLists, groups, callback);
            return;
        }

        var groups = groups; // This is needed for the scope.

        var browser = document.createElement("browser");
        browser.setAttribute("type", "content");
        browser.setAttribute("disableHistory", "true");
        document.documentElement.appendChild(browser);

        this.loadTestList(browser, testList.testListURL, function(tempGroups)
        {
            document.documentElement.removeChild(browser);

            if (tempGroups)
            {
                for (var i=0; i<tempGroups.length; i++)
                {
                    var group = tempGroups[i];
                    group.extension = testList.extension;
                    groups.push(group);
                }
            }

            // Continue with the next list.
            TestListLoader.loadNextTest(testLists, groups, callback);
        });
    },

    getRegisteredTestLists: function()
    {
        // Dispatch event to the right instance Firebug (within the tested browser
        // window) to get all registered test lists.
        var Firebug = FBTestApp.FBTest.FirebugWindow.Firebug;

        var testLists = [];
        dispatch([Firebug], "onGetTestList", [testLists]);
        dispatch(Firebug.modules, "onGetTestList", [testLists]);

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.getRegisteredTestLists; ", testLists);

        return testLists;
    },

    processTestList: function(doc)
    {
        var win = unwrapObject(doc.defaultView);
        if (!win.testList)
            return;

        this.addStyleSheets(doc);

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.loadTestList; processTestList " + win.driverBaseURI +
                ", serverURI " + win.testCasePath, win);

        var testListPath; // full path to the test list, eg a URL for the testList.html
        var driverBaseURI;  // base for test drivers, must be a secure location, chrome or https
        var testCasePath;  // base for testcase pages. These are normal web pages
        var testIncludes;  // additional includes for the test driver file.

        testListPath = doc.location.href;

        if (win.driverBaseURI)
        {
            driverBaseURI = win.driverBaseURI;
        }
        else
        {
            // If the driverBaseURI isn't provided use the directory where testList.html
            // file is located.
            //testListPath.substr(0, testListPath.lastIndexOf("/") + 1);
            driverBaseURI = "https://getfirebug.com/tests/content/";
        }

        if (win.serverURI)
            testCasePath = win.serverURI;
        else
            testCasePath = "https://getfirebug.com/tests/content/";

        if (win.testIncludes)
            testIncludes = win.testIncludes;
        else
            testIncludes = [];

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.processTestList; driverBaseURI " + this.driverBaseURI +
                ", serverURI " + this.testCasePath);

        FBTestApp.TestConsole.testListPath = testListPath;
        FBTestApp.TestConsole.testCasePath = testCasePath;
        FBTestApp.TestConsole.driverBaseURI = driverBaseURI;

        var groups = [];
        var map = [];

        // Create group list from the provided test list. Also clone all JS objects
        // (tests) since they come from untrusted content.
        var testCount = win.testList.length;
        for (var i=0; i<testCount; i++)
        {
            var test = win.testList[i];

            // If the test isn't targeted for the current OS, mark it as "fails".
            if (!this.isTargetOS(test))
                test.category = "fails";

            var group = map[test.group];
            if (!group)
            {
                group = new FBTestApp.TestGroup(test.group);
                group.testListPath = testListPath;

                groups.push(map[test.group] = group);
            }

            // Default value for category attribute is "passes".
            if (!test.category)
                test.category = "passes";

            // Create real test object.
            var realTest = new FBTestApp.Test(group, test.uri, test.desc, test.category, test.testPage);
            realTest.testListPath = testListPath;
            realTest.driverBaseURI = driverBaseURI;
            realTest.testCasePath = testCasePath;
            realTest.testIncludes = testIncludes;

            group.tests.push(realTest);
        }

        return groups;
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
    // Helpers

    addStyleSheets: function(doc)
    {
        // Some CSS from Firebug namespace.
        addStyleSheet(doc, createStyleSheet(doc, "chrome://firebug/skin/dom.css"));
        addStyleSheet(doc, createStyleSheet(doc, "chrome://firebug-os/skin/panel.css"));
        addStyleSheet(doc, createStyleSheet(doc, "chrome://firebug/skin/console.css"));

        // Append specific FBTest CSS.
        var styles = ["testConsole.css", "testList.css", "testResult.css", "tabView.css"];
        for (var i=0; i<styles.length; i++)
            addStyleSheet(doc, createStyleSheet(doc, "chrome://fbtest/skin/" + styles[i]));
    },

    /**
     * Returns true if the test is targeted for the current OS; otherwise false.
     */
    isTargetOS: function(test)
    {
        // If there is no target OS, the test is intended for all.
        if (!test.os)
            return true;

        var platform = window.navigator.platform.toLowerCase();

        // Iterate all specified OS and look for match.
        var list = test.os.toLowerCase().split("|");
        for (var p in list)
        {
            if (platform.indexOf(list[p]) != -1)
                return true;
        }

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.isTargetOS; Test is not targeted for this OS: " + test.uri);

        return false;
    }
};

// ************************************************************************************************

function BrowserLoadWatcher(browser, url, callback)
{
    this.browser = browser;
    this.callback = callback;

    // Wait for "DOMContentLoaded" event.
    this.domContentLoadedListener = bind(this.onDOMContentLoaded, this);
    this.browser.addEventListener("DOMContentLoaded", this.domContentLoadedListener, true);
    this.browser.setAttribute("src", url);
}

BrowserLoadWatcher.prototype =
{
    onDOMContentLoaded: function(event)
    {
        var target = event.target;

        // Remove "DOMContentLoaded" listener
        this.browser.removeEventListener("DOMContentLoaded", this.domContentLoadedListener, true);
        this.domContentLoadedListener = null;

        // If fbTestFrame element exists it's a swarm page.
        var fbTestFrame = target.getElementById("FBTest");
        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.watcher.onDOMContentLoaded; (frame=" +
                (fbTestFrame ? "yes" : "no") + "): " + target.location, target);

        if (fbTestFrame)
        {
            this.frameLoadedListener = bind(this.onFrameLoaded, this);
            fbTestFrame.contentDocument.addEventListener("load", this.frameLoadedListener, true);
        }
        else
        {
            this.windowLoadedListener = bind(this.onWindowLoaded, this);
            this.browser.addEventListener("load", this.windowLoadedListener, true);
        }
    },

    onFrameLoaded: function(event)
    {
        var target = event.target;

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.watcher.onFrameLoaded "+target.getAttribute("id"), target);

        if (target.getAttribute('id') === "FBTest")
        {
            this.callback(target.contentDocument);

            browser.removeEventListener("load", this.frameLoadedListener, true);
            this.frameLoadedListener = null;
        }
    },

    onWindowLoaded: function(event)
    {
        var target = event.target;

        if (FBTrace.DBG_FBTEST)
            FBTrace.sysout("fbtest.watcher.onWindowLoaded; "+target.location, target);

        this.callback(target);

        this.browser.removeEventListener("load", this.windowLoadedListener, true);
        this.windowLoadedListener = null;
    }
};

// ************************************************************************************************

// Shortcut
var TestListLoader = FBTestApp.TestListLoader;

// ************************************************************************************************
}});
