// ==UserScript==
// @name         Monitor Tab and Print Tradeling AWB
// @namespace    http://tampermonkey.net/
// @version      2025-02-20
// @description  Monitor Manage Picking tab and print AWB dynamically
// @author       You
// @match        https://tradeling.vineretail.com/eRetailWeb/selCompanyLocationBS.action
// @icon         https://www.google.com/s2/favicons?sz=64&domain=vineretail.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Function to monitor tab and iframe status
  function monitorTabAndStatus() {
    setInterval(() => {

      // Access the iframe element
      const iframe = document.getElementById('ManagePicking_IFrame');
      if (!iframe) {
        console.error('Iframe not found. Skipping check.');
        return;
      }

      // Access the iframe's document
      const iframeDocument = iframe.contentDocument || iframe.contentWindow.document;
      if (!iframeDocument) {
        console.error('Unable to access iframe document. Skipping check.');
        return;
      }

      // Check if the status is "Complete"
      const picklistStatusElement = iframeDocument.getElementById('statusText');
      const picklistStatus = picklistStatusElement?.textContent?.trim();
      const isStatusComplete = picklistStatus === 'Complete';

      if (isStatusComplete) {
        // Check if the button is already added
        const existingButton = document.getElementById('printTradelingAWBButton');
        if (!existingButton) {
          insertButton();
        } else {
        }
      } else {
        const existingButton = document.getElementById('printTradelingAWBButton');
        if (existingButton) {
          existingButton.remove();
        } else {
        }
      }
    }, 1000); // Check every 1 second
  }

  // Function to insert the "Print AWB" button
  function insertButton() {
    const iframe = document.getElementById('ManagePicking_IFrame');
    const iframeDocument = iframe?.contentDocument || iframe?.contentWindow.document;

    if (!iframeDocument) {
      console.error('Unable to access iframe document for API call.');
      return;
    }

    const isButtonExists = iframeDocument.getElementById('printTradelingAWBButton');
    if (isButtonExists) {
      return;
    }

    const navbarHistoryFieldset = iframeDocument.getElementById('orderHistoryDiv');
    if (navbarHistoryFieldset) {
      const printAWBButton = iframeDocument.createElement('button');
      printAWBButton.type = 'button';
      printAWBButton.id = 'printTradelingAWBButton';
      printAWBButton.textContent = 'Print Tradeling AWB';

      // Apply basic styling
      printAWBButton.style.padding = '8px 16px';
      printAWBButton.style.marginBottom = '10px';
      printAWBButton.style.backgroundColor = '#fb641e';
      printAWBButton.style.color = '#fff';
      printAWBButton.style.border = 'none';
      printAWBButton.style.borderRadius = '4px';
      printAWBButton.style.cursor = 'pointer';
      printAWBButton.style.width = '100%';

      printAWBButton.addEventListener('click', () => {
        printAWB();
      });

      navbarHistoryFieldset.parentNode.insertBefore(printAWBButton, navbarHistoryFieldset);
    } else {
      console.error('Element with ID "orderHistoryDiv" not found. Cannot insert button.');
    }
  }

  // Function to call the API when the button is clicked
  function printAWB() {
    const iframe = document.getElementById('ManagePicking_IFrame');
    const iframeDocument = iframe?.contentDocument || iframe?.contentWindow.document;

    if (!iframeDocument) {
      console.error('Unable to access iframe document for API call.');
      return;
    }

    const picklistNoElement = iframeDocument.getElementById('picklistNo_lbl');
    const picklistNo = picklistNoElement?.textContent?.trim();
    if (!picklistNo) {
      console.error('Picklist number not found in iframe. Cannot proceed with API call.');
      return;
    }


    // Generate current epoch time in milliseconds
    const rId = Date.now();

    fetch('https://tradeling.vineretail.com/eRetailWeb/jsonFetchProcessedDeliveries', {
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'en-US,en;q=0.9,ar-AE;q=0.8,ar;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        pragma: 'no-cache',
        priority: 'u=1, i',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-requested-with': 'XMLHttpRequest',
      },
      referrer: `https://tradeling.vineretail.com/eRetailWeb/skuWisePickingDisplay?picklistNo=${picklistNo}`,
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: `PickListNo=${picklistNo}&lpnNo=&DelNO=&PiPOnly=N&rId=${rId}`,
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.listOfMap?.length) {
          console.error('No data found for the provided picklist number.');
          return;
        }
        const links = data.listOfMap.map(
          (i) => `https://api.tradeling.com/api/shipping/v1/fulfillment-operations/download-awb?orderNumber=${i.ExtOrderNo}&shipmentNumber=${i.TrackingNo}&stageName=E2E`,
        );

        links.forEach((link) => {
          window.open(link, '_blank');
        });
      })
      .catch((error) => {
        console.error('Error calling API:', error);
      });
  }

  // Start monitoring the iframe and status
  monitorTabAndStatus();
})();
