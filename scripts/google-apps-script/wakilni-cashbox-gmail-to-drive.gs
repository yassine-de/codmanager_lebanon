const WAKILNI_INVOICE_FOLDER_ID = "1hpDtSIx3pzc7r5gm9LuSS28ALikhTBJr";
const WAKILNI_CASHBOX_SAVED_LABEL = "Wakilni/Cashbox-Saved";
const WAKILNI_CASHBOX_ERROR_LABEL = "Wakilni/Cashbox-Error";

function saveWakilniCashboxInvoicesToDrive() {
  const folder = DriveApp.getFolderById(WAKILNI_INVOICE_FOLDER_ID);
  const savedLabel = getOrCreateLabel_(WAKILNI_CASHBOX_SAVED_LABEL);
  const errorLabel = getOrCreateLabel_(WAKILNI_CASHBOX_ERROR_LABEL);

  const query = [
    "from:(wakilni)",
    "(subject:Cashbox OR subject:cashbox)",
    "has:attachment",
    "filename:pdf",
    "-label:" + WAKILNI_CASHBOX_SAVED_LABEL,
  ].join(" ");

  const threads = GmailApp.search(query, 0, 50);
  const result = {
    scannedThreads: threads.length,
    savedFiles: 0,
    skippedExisting: 0,
    errors: [],
  };

  threads.forEach((thread) => {
    try {
      const messages = thread.getMessages();
      let threadSaved = false;

      messages.forEach((message) => {
        const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });

        attachments.forEach((attachment) => {
          const name = attachment.getName() || "";
          const isPdf = attachment.getContentType() === "application/pdf" || /\.pdf$/i.test(name);
          const isCashbox = /cashbox|statement/i.test(name) || /cashbox|statement/i.test(message.getSubject());
          if (!isPdf || !isCashbox) return;

          const targetName = normalizeInvoiceFileName_(name, message.getSubject(), message.getDate());
          if (fileExists_(folder, targetName)) {
            result.skippedExisting += 1;
            threadSaved = true;
            return;
          }

          folder.createFile(attachment.copyBlob()).setName(targetName);
          result.savedFiles += 1;
          threadSaved = true;
        });
      });

      if (threadSaved) {
        thread.addLabel(savedLabel);
        thread.removeLabel(errorLabel);
      }
    } catch (error) {
      thread.addLabel(errorLabel);
      result.errors.push({
        threadId: thread.getId(),
        subject: thread.getFirstMessageSubject(),
        message: error && error.message ? error.message : String(error),
      });
    }
  });

  console.log(JSON.stringify(result));
  return result;
}

function createWakilniCashboxTrigger() {
  deleteWakilniCashboxTriggers();

  ScriptApp.newTrigger("saveWakilniCashboxInvoicesToDrive")
    .timeBased()
    .everyDays(1)
    .atHour(10)
    .create();

  ScriptApp.newTrigger("saveWakilniCashboxInvoicesToDrive")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(14)
    .create();
}

function deleteWakilniCashboxTriggers() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === "saveWakilniCashboxInvoicesToDrive") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function fileExists_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  return files.hasNext();
}

function normalizeInvoiceFileName_(originalName, subject, messageDate) {
  const dateFromName = String(originalName).match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (dateFromName) {
    return `Wakilni_Cashbox_Statement_${dateFromName[1]}-${dateFromName[2]}-${dateFromName[3]}.pdf`;
  }

  const text = `${originalName || ""} ${subject || ""}`;
  const monthDate = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[_\s-]+(\d{1,2}),?\s*(\d{4})\b/i);
  if (monthDate) {
    const monthIndex = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    }[monthDate[1].slice(0, 3).toLowerCase()];
    return `Wakilni_Cashbox_Statement_${monthDate[3]}-${monthIndex}-${String(monthDate[2]).padStart(2, "0")}.pdf`;
  }

  const subjectDate = String(subject || "").match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (subjectDate) {
    return `Wakilni_Cashbox_Statement_${subjectDate[1]}-${subjectDate[2]}-${subjectDate[3]}.pdf`;
  }

  const date = new Date(messageDate);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `Wakilni_Cashbox_Statement_${yyyy}-${mm}-${dd}.pdf`;
}
